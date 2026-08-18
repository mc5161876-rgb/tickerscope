"""Linkbase-aware SEC segment-revenue extractor (ported from traderscope, Aug 2026).

The extractor:
  * filters candidate dimensions to legitimate segment/product/geography axes;
  * reads definition/presentation linkbases to remove subtotal members;
  * models elimination/intersegment members explicitly;
  * preserves enough diagnostics to explain every pass or withheld chart.

Port notes (MAR-49): the pure functions are unchanged from
`traderscope/backend/traderscope_data/extractor.py` @ 1336a20 so the ported tests stay green.
`Fetcher` moved to `client.py`. The old monolithic `run()` is split into `parse_filing()` and
`evaluate_period()` so TickerScope can walk ten years of 10-Ks / 10-Qs; `run()` remains for the
corpus regression (latest annual period per ticker, same output shape as before).
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .client import Fetcher

TICKERS = [
    "MSFT", "GOOGL", "META", "AMZN", "AAPL", "NVDA", "INTC", "DIS",
    "COST", "WMT", "DE", "JPM", "BAC", "V", "TSM", "SAP", "TM",
    "XOM", "UNH", "PFE",
]  # fmt: skip

REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "Revenue",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "RevenueFromContractsWithCustomers",
    "TotalRevenuesAndOtherIncome",
    "RevenuesNetOfInterestExpense",
    "InterestAndDividendIncomeOperating",
]
REVENUE_TAGS_SET = set(REVENUE_TAGS)

# Reconciliation ranks candidates only after this semantic gate. This prevents
# subsidiary/customer/legal-entity dimensions from winning by numerical accident.
AXIS_ALLOW_PATTERNS = [
    re.compile(p, re.I)
    for p in (
        r"BusinessSegmentsAxis$",
        r"OperatingSegmentsAxis$",
        r"ReportableSegmentsAxis$",
        r"SegmentsAxis$",
        r"StatementGeographicalAxis$",
        r"GeographicalAxis$",
        r"ProductOrServiceAxis$",
        r"ProductsAndServicesAxis$",
    )
]
AXIS_DENY_PATTERNS = [
    re.compile(p, re.I)
    for p in (
        r"Subsidiar",
        r"MajorCustomers",
        r"CustomerAxis",
        r"LegalEntit",
        r"ConsolidationItems",
    )
]
ELIMINATION_PATTERN = re.compile(r"eliminat|intersegment|inter-segment|reconcil|unallocated", re.I)
BRIDGE_MEMBER_PATTERN = re.compile(
    r"Corporate.*NonSegment|MaterialReconciling|ReconcilingItems|"
    r"CorporateAndEliminations|Other.*NonSegment",
    re.I,
)

XLINK = "http://www.w3.org/1999/xlink"

ANNUAL_DAYS = (330, 380)
QUARTER_DAYS = (80, 100)


def local_name(tag: str) -> str:
    return tag.split("}")[-1]


def concept_local(value: str | None) -> str:
    """Normalize QName or linkbase href fragment to a local concept name."""
    if not value:
        return ""
    value = value.split("#")[-1]
    if ":" in value:
        return value.split(":")[-1]
    # Linkbase href fragments are commonly namespace_ConceptName. Prefer a
    # known XBRL namespace split, then fall back to the first underscore.
    for prefix in ("us-gaap_", "ifrs-full_", "srt_", "dei_"):
        if value.startswith(prefix):
            return value[len(prefix) :]
    return value.split("_", 1)[-1] if "_" in value else value


def duration_days(period: tuple[str, str]) -> int:
    start = date.fromisoformat(period[0])
    end = date.fromisoformat(period[1])
    return (end - start).days


def axis_allowed(axis: str) -> bool:
    name = concept_local(axis)
    if any(p.search(name) for p in AXIS_DENY_PATTERNS):
        return False
    return any(p.search(name) for p in AXIS_ALLOW_PATTERNS)


def axis_priority(axis: str) -> int:
    """Prefer reportable-segment axes over secondary product/geography views."""
    name = concept_local(axis)
    if re.search(
        r"BusinessSegments|OperatingSegments|ReportableSegments|^SegmentsAxis$", name, re.I
    ):
        return 0
    if re.search(r"Geograph", name, re.I):
        return 1
    if re.search(r"Product|Service", name, re.I):
        return 2
    return 9


def project_segment_dimension(
    dimensions: dict[str, str],
) -> tuple[str, str] | None:
    """Project a multi-dimensional context onto its reportable-segment axis.

    IFRS and insurance filings commonly qualify a segment fact with scenario,
    consolidation, customer, or product dimensions. Reject unknown qualifiers;
    never discard dimensions blindly.
    """
    allowed = [
        (axis_priority(axis), axis, member)
        for axis, member in dimensions.items()
        if axis_allowed(axis)
    ]
    if not allowed:
        return None
    allowed.sort(key=lambda item: item[0])
    best_priority = allowed[0][0]
    if sum(priority == best_priority for priority, _, _ in allowed) != 1:
        return None
    _, chosen_axis, chosen_member = allowed[0]

    safe_axis_fragments = (
        "ScenarioAxis",
        "ConsolidationItemsAxis",
        "MajorCustomersAxis",
        "ProductOrServiceAxis",
        "ProductsAndServicesAxis",
    )
    safe_member_fragments = (
        "ActualCurrencyMember",
        "OperatingSegmentsMember",
        "ExternalCustomersMember",
        "ProductMember",
        "ServiceMember",
    )
    for axis, member in dimensions.items():
        if axis == chosen_axis:
            continue
        if axis_allowed(axis) and axis_priority(axis) > best_priority:
            # A lower-priority product/geography axis may qualify a reportable
            # business segment, but only generic product/service members are safe.
            if not any(fragment in concept_local(member) for fragment in safe_member_fragments):
                return None
            continue
        if not any(fragment in concept_local(axis) for fragment in safe_axis_fragments):
            return None
        if not any(fragment in concept_local(member) for fragment in safe_member_fragments):
            return None
    return chosen_axis, chosen_member


def project_consolidation_bridge(dimensions: dict[str, str]) -> tuple[str, str] | None:
    """Return a filed Corporate/Other or reconciling row outside a segment axis.

    Some issuers put reportable segments on StatementBusinessSegmentsAxis but
    the Corporate and reconciliation rows needed to reach consolidated revenue
    on ConsolidationItemsAxis. Keep these facts separate from segment members;
    they may only be used as an explicit reconciliation bridge.
    """
    if any(axis_allowed(axis) for axis in dimensions):
        return None
    matches = [
        (axis, member)
        for axis, member in dimensions.items()
        if "ConsolidationItemsAxis" in concept_local(axis)
        and BRIDGE_MEMBER_PATTERN.search(concept_local(member))
    ]
    if len(matches) != 1:
        return None
    chosen_axis, chosen_member = matches[0]
    for axis, member in dimensions.items():
        if axis == chosen_axis:
            continue
        if "ScenarioAxis" not in concept_local(axis):
            return None
        if "ActualCurrencyMember" not in concept_local(member):
            return None
    return chosen_axis, chosen_member


# --------------------------------------------------------------------------- submissions
def annual_filings(submissions: dict, fetcher: Fetcher) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    recent = submissions["filings"]["recent"]
    rows.extend(
        (form, accession, filed)
        for form, accession, filed in zip(
            recent["form"], recent["accessionNumber"], recent["filingDate"], strict=False
        )
        if form in ("10-K", "20-F")
    )
    if not rows:
        for extra in submissions["filings"].get("files", []):
            history = json.loads(fetcher.get(f"https://data.sec.gov/submissions/{extra['name']}"))
            rows.extend(
                (form, accession, filed)
                for form, accession, filed in zip(
                    history["form"], history["accessionNumber"], history["filingDate"], strict=False
                )
                if form in ("10-K", "20-F")
            )
            if rows:
                break
    return sorted(rows, key=lambda row: row[2], reverse=True)


@dataclass(frozen=True)
class FilingRef:
    form: str
    accession: str
    filed: str
    report_date: str | None


def filings_since(
    submissions: dict,
    fetcher: Fetcher,
    forms: tuple[str, ...],
    since: str,
) -> list[FilingRef]:
    """All filings of the given forms filed on/after `since` (ISO date), newest first.

    Walks the paginated submission history files when the recent window is not enough.
    """
    out: list[FilingRef] = []

    def collect(block: dict) -> bool:
        """Append matches; return True when we've gone past `since` (older than needed)."""
        forms_ = block.get("form", [])
        accs = block.get("accessionNumber", [])
        filed = block.get("filingDate", [])
        reports = block.get("reportDate", [None] * len(forms_))
        older_seen = False
        for i, form in enumerate(forms_):
            if i >= len(accs) or i >= len(filed):
                continue
            if filed[i] < since:
                older_seen = True
                continue
            if form in forms:
                out.append(
                    FilingRef(form, accs[i], filed[i], reports[i] if i < len(reports) else None)
                )
        return older_seen

    recent = submissions["filings"]["recent"]
    reached_past = collect(recent)
    if not reached_past:
        for extra in submissions["filings"].get("files", []):
            history = json.loads(fetcher.get(f"https://data.sec.gov/submissions/{extra['name']}"))
            if collect(history):
                break
    # newest first, de-dupe accessions
    seen: set[str] = set()
    ordered: list[FilingRef] = []
    for ref in sorted(out, key=lambda r: r.filed, reverse=True):
        if ref.accession in seen:
            continue
        seen.add(ref.accession)
        ordered.append(ref)
    return ordered


def resolve_predecessor_by_file_number(
    submissions: dict, current_cik: str, fetcher: Fetcher
) -> tuple[str, dict, list[tuple[str, str, str]], str] | None:
    """Resolve a successor with no annuals through its SEC file number.

    Rule 12g-3 successor filings commonly preserve the predecessor's Commission
    File Number. The SEC's official file-number Atom feed exposes the associated
    historical CIK, avoiding fuzzy name matching or ticker-specific exceptions.
    """
    recent = submissions["filings"]["recent"]
    forms = recent.get("form", [])
    file_numbers = recent.get("fileNumber", [])
    accessions = recent.get("accessionNumber", [])
    primary_documents = recent.get("primaryDocument", [])
    candidates = []
    for index, form in enumerate(forms):
        if form != "8-K12B" or index >= len(file_numbers):
            continue
        if index < len(accessions) and index < len(primary_documents):
            accession_compact = accessions[index].replace("-", "")
            primary_url = (
                f"https://www.sec.gov/Archives/edgar/data/{int(current_cik)}/"
                f"{accession_compact}/{primary_documents[index]}"
            )
            document = fetcher.get(primary_url).decode("utf-8", errors="ignore")
            for document_file_number in re.findall(r"\b\d{3}-\d{5}\b", document):
                if document_file_number not in candidates:
                    candidates.append(document_file_number)
        file_number = file_numbers[index]
        if file_number and file_number not in candidates:
            candidates.append(file_number)

    for file_number in candidates:
        query = urllib.parse.urlencode(
            {
                "action": "getcompany",
                "filenum": file_number,
                "owner": "exclude",
                "output": "atom",
                "count": "100",
            }
        )
        feed = ET.fromstring(fetcher.get(f"https://www.sec.gov/cgi-bin/browse-edgar?{query}"))
        resolved_cik = None
        for element in feed.iter():
            if local_name(element.tag) == "company-info":
                for child in element:
                    if local_name(child.tag) == "cik" and child.text:
                        resolved_cik = child.text.zfill(10)
                        break
                break
        if not resolved_cik or resolved_cik == current_cik:
            continue
        resolved_submissions = json.loads(
            fetcher.get(f"https://data.sec.gov/submissions/CIK{resolved_cik}.json")
        )
        filings = annual_filings(resolved_submissions, fetcher)
        if filings:
            return resolved_cik, resolved_submissions, filings, file_number
    return None


# --------------------------------------------------------------------------- XBRL parsing
def filing_files(index: dict) -> list[str]:
    return [item["name"] for item in index["directory"]["item"]]


_NOT_INSTANCE = re.compile(
    r"(^|/)(FilingSummary|MetaLinks)\.(xml|json)$|_(cal|def|lab|pre|ref)\.xml$", re.I
)


def select_instance(names: Iterable[str]) -> str | None:
    """Pick the XBRL instance document in a filing directory.

    TickerScope change vs the port: pre-2019 (non-inline) filings ship a classic
    `<prefix>-YYYYMMDD.xml` instance next to `FilingSummary.xml`; the port's alphabetical pick
    landed on FilingSummary.xml and silently yielded no facts. Prefer inline `_htm.xml`, then the
    classic dated instance, then any remaining XML that is not a linkbase / summary / R-file.
    """
    names = list(names)
    inline_instances = [name for name in names if name.endswith("_htm.xml")]
    if inline_instances:
        return inline_instances[0]
    dated = [
        name
        for name in names
        if re.search(r"-\d{8}\.xml$", name) and not _NOT_INSTANCE.search(name)
    ]
    if dated:
        return dated[0]
    candidates = [
        name
        for name in names
        if name.endswith(".xml") and not _NOT_INSTANCE.search(name) and not name.startswith("R")
    ]
    return candidates[0] if candidates else None


def parse_contexts(root: ET.Element) -> dict[str, tuple[dict[str, str], dict[str, str]]]:
    contexts: dict[str, tuple[dict[str, str], dict[str, str]]] = {}
    for context in root.iter():
        if local_name(context.tag) != "context":
            continue
        period: dict[str, str] = {}
        dimensions: dict[str, str] = {}
        for element in context.iter():
            name = local_name(element.tag)
            if name in ("startDate", "endDate") and element.text:
                period[name] = element.text
            elif name == "explicitMember" and element.text:
                dimensions[element.get("dimension", "")] = element.text
        contexts[context.get("id", "")] = (period, dimensions)
    return contexts


def parse_units(root: ET.Element) -> dict[str, str]:
    units: dict[str, str] = {}
    for unit in root.iter():
        if local_name(unit.tag) != "unit":
            continue
        measures = [
            element.text
            for element in unit.iter()
            if local_name(element.tag) == "measure" and element.text
        ]
        if measures:
            units[unit.get("id", "")] = measures[0].split(":")[-1]
    return units


_LABEL_ROLE_RANK = {
    "terseLabel": 0,
    "label": 1,  # standard label
    "verboseLabel": 2,
    "totalLabel": 3,
    "periodEndLabel": 4,
    "periodStartLabel": 4,
    "negatedLabel": 5,
    "negatedTerseLabel": 5,
}


def parse_labels(xml: bytes | None) -> dict[str, list[str]]:
    """concept -> label texts, best display label first.

    TickerScope change vs the traderscope port: label *roles* are ranked (terse > standard >
    verbose > ...) and `documentation` labels are ignored, so "AWS" beats
    "AmazonWebServicesSegment [Member]". Every text is still kept for elimination/rollup matching.
    """
    if not xml:
        return {}
    root = ET.fromstring(xml)
    ranked: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    order = 0
    for link in root.iter():
        if local_name(link.tag) != "labelLink":
            continue
        locators: dict[str, str] = {}
        resources: dict[str, tuple[str, str]] = {}
        arcs: list[tuple[str, str]] = []
        for child in link:
            name = local_name(child.tag)
            label = child.get(f"{{{XLINK}}}label", "")
            if name == "loc":
                locators[label] = concept_local(child.get(f"{{{XLINK}}}href"))
            elif name == "label":
                role = child.get(f"{{{XLINK}}}role", "").rsplit("/", 1)[-1]
                # a resource label may carry several texts (one per role); keep them all
                resources.setdefault(label, ("", ""))
                text = " ".join("".join(child.itertext()).split())
                key = f"{label}\x00{role}"
                resources[key] = (role, text)
            elif name == "labelArc":
                arcs.append(
                    (
                        child.get(f"{{{XLINK}}}from", ""),
                        child.get(f"{{{XLINK}}}to", ""),
                    )
                )
        for source, target in arcs:
            concept = locators.get(source)
            if not concept:
                continue
            for key, (role, text) in resources.items():
                if not key.startswith(f"{target}\x00") or not text:
                    continue
                if role == "documentation":
                    continue
                order += 1
                ranked[concept].append((_LABEL_ROLE_RANK.get(role, 9), order, text))
    labels: dict[str, list[str]] = defaultdict(list)
    for concept, items in ranked.items():
        for _, _, text in sorted(items):
            if text not in labels[concept]:
                labels[concept].append(text)
    return labels


def parse_relationship_graphs(xml: bytes | None) -> list[dict[str, set[str]]]:
    """Return one concept graph per extended definition/presentation link."""
    if not xml:
        return []
    root = ET.fromstring(xml)
    graphs: list[dict[str, set[str]]] = []
    for link in root.iter():
        if local_name(link.tag) not in ("definitionLink", "presentationLink"):
            continue
        locators: dict[str, str] = {}
        arcs: list[tuple[str, str]] = []
        for child in link:
            name = local_name(child.tag)
            if name == "loc":
                locators[child.get(f"{{{XLINK}}}label", "")] = concept_local(
                    child.get(f"{{{XLINK}}}href")
                )
            elif name in ("definitionArc", "presentationArc"):
                arcrole = child.get(f"{{{XLINK}}}arcrole", "")
                if name == "definitionArc" and not any(
                    role in arcrole
                    for role in ("domain-member", "dimension-domain", "hypercube-dimension")
                ):
                    continue
                arcs.append(
                    (
                        child.get(f"{{{XLINK}}}from", ""),
                        child.get(f"{{{XLINK}}}to", ""),
                    )
                )
        graph: dict[str, set[str]] = defaultdict(set)
        for source_label, target_label in arcs:
            source = locators.get(source_label)
            target = locators.get(target_label)
            if source and target and source != target:
                graph[source].add(target)
        if graph:
            graphs.append(graph)
    return graphs


def descendants(graph: dict[str, set[str]], node: str) -> set[str]:
    seen: set[str] = set()
    pending = list(graph.get(node, ()))
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        pending.extend(graph.get(current, ()))
    return seen


def best_graph_for_members(
    graphs: Iterable[dict[str, set[str]]], members: Iterable[str]
) -> tuple[dict[str, set[str]] | None, int]:
    member_set = {concept_local(member) for member in members}
    best: dict[str, set[str]] | None = None
    best_coverage = 0
    for graph in graphs:
        nodes = set(graph)
        for children in graph.values():
            nodes.update(children)
        coverage = len(nodes & member_set)
        if coverage > best_coverage:
            best = graph
            best_coverage = coverage
    return best, best_coverage


def is_elimination(member: str, labels: dict[str, list[str]]) -> bool:
    local = concept_local(member)
    text = " ".join([local, *labels.get(local, [])])
    return bool(ELIMINATION_PATTERN.search(text))


def is_semantic_rollup(member: str, labels: dict[str, list[str]]) -> bool:
    local = concept_local(member)
    text = " ".join([local, *labels.get(local, [])])
    return bool(
        re.search(
            r"(^|\b)total\b|\bNonUsMember\b|\bProductMember\b|Combined.*Member|\bAllSegmentsMember\b",
            text,
            re.I,
        )
    )


def linkbase_adjusted_components(
    facts: dict[str, int],
    graphs: list[dict[str, set[str]]],
    labels: dict[str, list[str]],
    consolidated: int | None,
) -> dict:
    local_to_original = {concept_local(member): member for member in facts}
    local_facts = {concept_local(member): value for member, value in facts.items()}
    graph, coverage = best_graph_for_members(graphs, local_facts)

    subtotal_members: set[str] = set()
    if graph:
        observed = set(local_facts)
        for member in observed:
            if descendants(graph, member) & observed:
                subtotal_members.add(member)

    leaf_members = set(local_facts) - subtotal_members
    eliminations = {member for member in leaf_members if is_elimination(member, labels)}
    operating_members = leaf_members - eliminations

    strategies: list[tuple[str, set[str], int]] = []
    raw_sum = sum(local_facts.values())
    strategies.append(("raw", set(local_facts), raw_sum))
    leaf_sum = sum(local_facts[member] for member in leaf_members)
    strategies.append(("linkbase_leaves", leaf_members, leaf_sum))

    if eliminations:
        operating_sum = sum(local_facts[member] for member in operating_members)
        filed_elim = sum(local_facts[member] for member in eliminations)
        strategies.append(
            ("leaves_plus_filed_eliminations", leaf_members, operating_sum + filed_elim)
        )
        # Some filing instances expose elimination magnitudes as positive facts.
        # Keep this as an explicit, diagnosed alternative rather than silently
        # treating them as ordinary segments.
        strategies.append(
            (
                "leaves_minus_elimination_magnitudes",
                leaf_members,
                operating_sum - sum(abs(local_facts[m]) for m in eliminations),
            )
        )

    subset_alternatives: list[dict] = []
    # Some valid filings model a subtotal and its detail rows as siblings in
    # the definition linkbase. In that case hierarchy cannot disambiguate
    # them. For small member sets, enumerate subsets and prefer the most
    # detailed combination that independently reconciles. Preserve every
    # near-exact alternative so production code can surface ambiguity.
    subset_pool = leaf_members if subtotal_members else set(local_facts)
    if consolidated not in (None, 0) and 2 <= len(subset_pool) <= 12:
        ranked_subsets: list[tuple[float, int, set[str], int]] = []
        member_names = sorted(subset_pool)
        for size in range(2, len(member_names) + 1):
            for subset_tuple in itertools.combinations(member_names, size):
                subset = set(subset_tuple)
                excluded = subset_pool - subset
                if any(
                    not is_elimination(member, labels) and not is_semantic_rollup(member, labels)
                    for member in excluded
                ):
                    continue
                value = sum(local_facts[member] for member in subset)
                delta = abs(value - consolidated) / abs(consolidated) * 100
                ranked_subsets.append((delta, -size, subset, value))
        ranked_subsets.sort(key=lambda item: (item[0], item[1]))
        if ranked_subsets:
            best_delta, _, best_subset, best_value = ranked_subsets[0]
            strategies.append(("max_detail_reconciled_subset", best_subset, best_value))
            subset_alternatives = [
                {
                    "delta_pct": round(delta, 4),
                    "members": sorted(local_to_original[member] for member in subset),
                }
                for delta, _, subset, _ in ranked_subsets
                if delta < 0.5
            ][:10]

    def score(item: tuple[str, set[str], int]) -> float:
        if consolidated in (None, 0):
            return float("inf")
        return abs(item[2] - consolidated) / abs(consolidated) * 100

    chosen = min(strategies, key=score) if consolidated is not None else strategies[1]
    strategy, chosen_members, chosen_sum = chosen
    return {
        "strategy": strategy,
        "sum": chosen_sum,
        "members": sorted(local_to_original[m] for m in chosen_members),
        "leaf_members": sorted(local_to_original[m] for m in leaf_members),
        "subtotal_members_removed": sorted(local_to_original[m] for m in subtotal_members),
        "elimination_members": sorted(local_to_original[m] for m in eliminations),
        "linkbase_member_coverage": coverage,
        "delta_pct": round(score(chosen), 4) if consolidated not in (None, 0) else None,
        "strategy_scores": {
            name: round(score((name, members, value)), 4) if consolidated not in (None, 0) else None
            for name, members, value in strategies
        },
        "subset_alternatives": subset_alternatives,
    }


def add_consolidation_bridge(
    adjusted: dict,
    bridge_facts: dict[str, int],
    consolidated: int | None,
) -> dict:
    """Add signed filed bridge facts only when they improve reconciliation."""
    result = dict(adjusted)
    result["bridge_members"] = []
    result["bridge_member_values"] = {}
    if not bridge_facts or consolidated in (None, 0):
        return result
    bridged_sum = adjusted["sum"] + sum(bridge_facts.values())
    bridged_delta = abs(bridged_sum - consolidated) / abs(consolidated) * 100
    current_delta = adjusted.get("delta_pct")
    if current_delta is None or bridged_delta >= current_delta:
        return result
    result["base_strategy"] = adjusted["strategy"]
    result["strategy"] = f"{adjusted['strategy']}+filed_consolidation_bridge"
    result["sum"] = bridged_sum
    result["delta_pct"] = round(bridged_delta, 4)
    result["bridge_members"] = sorted(bridge_facts)
    result["bridge_member_values"] = {
        member: bridge_facts[member] for member in sorted(bridge_facts)
    }
    return result


def member_label(member: str, labels: dict[str, list[str]]) -> str:
    local = concept_local(member)
    if re.search(r"Corporate.*NonSegment", local, re.I):
        return "Corporate"
    if re.search(r"MaterialReconciling", local, re.I):
        return "Material reconciling items"
    if labels.get(local):
        text = labels[local][0]
        text = re.sub(r"\s*\[Member\]\s*$", "", text, flags=re.I)
        text = re.sub(r"\s+Segment$", "", text, flags=re.I)
        if text.isupper() and len(text) > 4:
            text = text.title()
        return text.replace(" And ", " and ")
    text = re.sub(r"Member$", "", local)
    return re.sub(r"(?<!^)(?=[A-Z])", " ", text).strip()


def build_chart_contract(
    adjusted: dict,
    raw_facts: dict[str, int],
    labels: dict[str, list[str]],
    consolidated: int | None,
) -> dict:
    """Build typed chart components without asking the UI to infer semantics."""
    rows: list[dict] = []
    bridge_rows: list[dict] = []
    elimination_members = set(adjusted.get("elimination_members", []))
    base_strategy = adjusted.get("base_strategy", adjusted.get("strategy", ""))

    for member in adjusted.get("members", []):
        value = raw_facts[member]
        if member in elimination_members or value < 0:
            if (
                member in elimination_members
                and base_strategy == "leaves_minus_elimination_magnitudes"
            ):
                value = -abs(value)
            bridge_rows.append(
                {
                    "label": member_label(member, labels),
                    "value": value,
                    "type": "filed_elimination",
                    "concept": member,
                }
            )
        else:
            # TickerScope change vs the port: a Corporate / reconciling member that an issuer files
            # *on* the segment axis (JPM 2017-2019) is still not a reportable segment. Type it
            # corporate_nonsegment so it is muted, sorted last, excluded from the segment count,
            # and does not read as a re-segmentation when a later filing moves it to a bridge axis.
            is_corporate = bool(BRIDGE_MEMBER_PATTERN.search(concept_local(member)))
            rows.append(
                {
                    "label": member_label(member, labels),
                    "value": value,
                    "type": "corporate_nonsegment" if is_corporate else "reportable_segment",
                    "concept": member,
                }
            )

    for member, value in adjusted.get("bridge_member_values", {}).items():
        component = {
            "label": member_label(member, labels),
            "value": value,
            "concept": member,
        }
        if value >= 0:
            component["type"] = "corporate_nonsegment"
            rows.append(component)
        else:
            component["type"] = "filed_reconciling_item"
            bridge_rows.append(component)

    rows.sort(key=lambda item: item["type"] == "corporate_nonsegment")
    positive_stack_total = sum(item["value"] for item in rows)
    signed_bridge_total = sum(item["value"] for item in bridge_rows)
    return {
        "rows": rows,
        "positive_stack_total": positive_stack_total,
        "consolidation_bridge": bridge_rows,
        "signed_bridge_total": signed_bridge_total,
        "calculated_total": positive_stack_total + signed_bridge_total,
        "consolidated_total": consolidated,
        "reconciliation_delta_pct": adjusted.get("delta_pct"),
        "reportable_segment_count": sum(item["type"] == "reportable_segment" for item in rows),
    }


def alternative_kind(axis: str) -> tuple[str, str, str]:
    """Return stable API kind, title, and row type for a secondary axis."""
    local = concept_local(axis)
    if re.search(r"Geograph", local, re.I):
        return "geography", "Revenue by Region", "geographic_region"
    if re.search(r"Product|Service", local, re.I):
        return "product_service", "Revenue by Product or Service", "product_service"
    return "other", "Alternative Revenue Breakdown", "breakdown_component"


def reconciled_alternative_contract(
    candidates: list[tuple],
    selected_priority: int,
    labels: dict[str, list[str]],
    consolidated: int | None,
) -> dict | None:
    """Build the best honestly labelled reconciled alternative, if one exists."""
    alternatives = [
        candidate
        for candidate in candidates
        if candidate[1] > selected_priority and candidate[0] < 0.5
    ]
    if not alternatives:
        return None
    alternatives.sort(key=lambda candidate: (candidate[1], candidate[0]))
    delta, _, _, axis, raw_facts, adjusted = alternatives[0]
    chart = build_chart_contract(adjusted, raw_facts, labels, consolidated)
    kind, label, row_type = alternative_kind(axis)
    rows = [
        {**row, "type": row_type} if row["type"] == "reportable_segment" else row
        for row in chart["rows"]
    ]
    return {
        "kind": kind,
        "label": label,
        "available": True,
        "axis": axis,
        "render_mode": "stacked",
        "rows": rows,
        "positive_stack_total": chart["positive_stack_total"],
        "consolidated_total": chart["consolidated_total"],
        "reconciliation_delta_pct": delta,
        "component_count": len(rows),
    }


def select_single_segment_candidate(
    segmented: dict,
    period: tuple[str, str],
    consolidated: int | None,
) -> tuple[float, str, str, str, int] | None:
    """Select an exact one-member reportable-business axis, if filed."""
    if consolidated in (None, 0):
        return None
    candidates: list[tuple[float, int, str, str, str, int]] = []
    for tag, axes in segmented.items():
        for axis, periods_by_axis in axes.items():
            facts = periods_by_axis.get(period, {})
            if axis_priority(axis) != 0 or len(facts) != 1:
                continue
            member, value = next(iter(facts.items()))
            delta = abs(value - consolidated) / abs(consolidated) * 100
            candidates.append((delta, axis_priority(axis), tag, axis, member, value))
    candidates.sort(key=lambda item: (0 if item[0] < 0.5 else 1, item[0]))
    if not candidates or candidates[0][0] >= 0.5:
        return None
    delta, _, tag, axis, member, value = candidates[0]
    return round(delta, 4), tag, axis, member, value


def fetch_optional(fetcher: Fetcher, base: str, names: list[str], suffix: str) -> bytes | None:
    matches = [name for name in names if name.endswith(suffix)]
    return fetcher.get(f"{base}/{matches[0]}") if matches else None


# --------------------------------------------------------------------------- per-filing API (new)
@dataclass
class FilingFacts:
    """Everything the extractor needs from one filing, parsed once, evaluated per period."""

    cik: str
    form: str
    accession: str
    filed: str
    base_url: str
    instance_name: str | None
    currency: str
    linkbases: dict
    graphs: list = field(default_factory=list)
    labels: dict = field(default_factory=dict)
    # tag -> axis -> period -> member -> value
    segmented: dict = field(default_factory=dict)
    # tag -> period -> member -> signed value
    consolidation_bridges: dict = field(default_factory=dict)
    # tag -> period -> value
    consolidated: dict = field(default_factory=dict)

    def periods(self, day_range: tuple[int, int]) -> list[tuple[str, str]]:
        lo, hi = day_range
        found: set[tuple[str, str]] = set()
        for tag_values in self.consolidated.values():
            found.update(p for p in tag_values if lo <= duration_days(p) <= hi)
        for axes in self.segmented.values():
            for periods_by_axis in axes.values():
                found.update(p for p in periods_by_axis if lo <= duration_days(p) <= hi)
        return sorted(found, key=lambda p: p[1], reverse=True)


def parse_filing(fetcher: Fetcher, cik: str, form: str, accession: str, filed: str) -> FilingFacts:
    """Fetch and parse one filing's XBRL instance + linkbases into FilingFacts."""
    accession_compact = accession.replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession_compact}"
    index = json.loads(fetcher.get(f"{base}/index.json"))
    names = filing_files(index)
    instance_name = select_instance(names)
    facts = FilingFacts(
        cik=cik,
        form=form,
        accession=accession,
        filed=filed,
        base_url=base,
        instance_name=instance_name,
        currency="?",
        linkbases={},
    )
    if not instance_name:
        return facts

    instance_root = ET.fromstring(fetcher.get(f"{base}/{instance_name}"))
    contexts = parse_contexts(instance_root)
    units = parse_units(instance_root)

    definition = fetch_optional(fetcher, base, names, "_def.xml")
    presentation = fetch_optional(fetcher, base, names, "_pre.xml")
    label_xml = fetch_optional(fetcher, base, names, "_lab.xml")
    facts.graphs = [
        *parse_relationship_graphs(definition),
        *parse_relationship_graphs(presentation),
    ]
    facts.labels = parse_labels(label_xml)
    facts.linkbases = {
        "definition": definition is not None,
        "presentation": presentation is not None,
        "labels": label_xml is not None,
        "graphs": len(facts.graphs),
    }

    segmented = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    consolidation_bridges = defaultdict(lambda: defaultdict(dict))
    consolidated = defaultdict(dict)
    currency_counts: dict[str, int] = defaultdict(int)

    for fact in instance_root.iter():
        tag = local_name(fact.tag)
        if tag not in REVENUE_TAGS_SET:
            continue
        period_data, dimensions = contexts.get(fact.get("contextRef", ""), ({}, {}))
        if not period_data.get("startDate") or not period_data.get("endDate"):
            continue
        if not fact.text:
            continue
        try:
            value = int(fact.text)
        except ValueError:
            continue
        currency = units.get(fact.get("unitRef", ""), "?")
        currency_counts[currency] += 1
        period = (period_data["startDate"], period_data["endDate"])
        if not dimensions:
            consolidated[tag][period] = value
        else:
            projected = project_segment_dimension(dimensions)
            if projected:
                axis, member = projected
                existing = segmented[tag][axis][period].get(member)
                if existing is None or existing == value:
                    segmented[tag][axis][period][member] = value
            else:
                bridge = project_consolidation_bridge(dimensions)
                if bridge:
                    _, member = bridge
                    existing = consolidation_bridges[tag][period].get(member)
                    if existing is None or existing == value:
                        consolidation_bridges[tag][period][member] = value

    facts.currency = max(currency_counts, key=currency_counts.get) if currency_counts else "?"
    facts.segmented = segmented
    facts.consolidation_bridges = consolidation_bridges
    facts.consolidated = consolidated
    return facts


def evaluate_period(ff: FilingFacts, period: tuple[str, str]) -> dict:
    """Run the traderscope selection logic for one period of one filing.

    Returns the same row shape the corpus runner produced (status, chart, alternative, ...).
    """
    row: dict = {
        "cik": ff.cik,
        "form": ff.form,
        "accn": ff.accession,
        "filed": ff.filed,
        "currency": ff.currency,
        "linkbases": ff.linkbases,
        "period": f"{period[0]}..{period[1]}",
        "period_start": period[0],
        "period_end": period[1],
    }
    if not ff.instance_name:
        row.update(status="UNAVAILABLE", reason="no XBRL instance in filing directory")
        return row

    consolidated_value = None
    consolidated_tag = None
    for tag in REVENUE_TAGS:
        if period in ff.consolidated.get(tag, {}):
            consolidated_value = ff.consolidated[tag][period]
            consolidated_tag = tag
            break
    row["consolidated"] = consolidated_value
    row["recon_tag"] = consolidated_tag

    single = select_single_segment_candidate(ff.segmented, period, consolidated_value)
    if single:
        delta, tag, axis, member, value = single
        row.update(
            status="SINGLE_SEGMENT",
            reason="issuer files one reconciled reportable-segment member",
            tag=tag,
            axis=concept_local(axis),
            raw_member_count=1,
            member_count=1,
            segment_sum=value,
            delta_pct=delta,
            members=[member],
            single_segment_fact={
                "concept": member,
                "value": value,
                "source_label": member_label(member, ff.labels),
            },
            chart={
                "render_mode": "single_segment",
                "rows": [],
                "positive_stack_total": consolidated_value,
                "consolidation_bridge": [],
                "signed_bridge_total": 0,
                "calculated_total": value,
                "consolidated_total": consolidated_value,
                "reconciliation_delta_pct": delta,
                "reportable_segment_count": 1,
            },
        )
        return row

    candidates = []
    for tag, axes in ff.segmented.items():
        for axis, periods_by_axis in axes.items():
            facts = periods_by_axis.get(period, {})
            if len(facts) < 2:
                continue
            adjusted = linkbase_adjusted_components(facts, ff.graphs, ff.labels, consolidated_value)
            if axis_priority(axis) == 0:
                adjusted = add_consolidation_bridge(
                    adjusted,
                    ff.consolidation_bridges.get(tag, {}).get(period, {}),
                    consolidated_value,
                )
            candidates.append(
                (adjusted["delta_pct"], axis_priority(axis), tag, axis, facts, adjusted)
            )

    candidates = [candidate for candidate in candidates if candidate[0] is not None]
    candidates.sort(
        key=lambda candidate: (candidate[1], 0 if candidate[0] < 0.5 else 1, candidate[0])
    )
    row["n_axes_tried"] = len(candidates)
    if not candidates:
        row.update(
            status="UNAVAILABLE",
            reason="no reconciled reportable-segment axis and no supported breakdown",
        )
        return row

    delta, selected_priority, tag, axis, raw_facts, adjusted = candidates[0]
    chart_contract = build_chart_contract(adjusted, raw_facts, ff.labels, consolidated_value)
    row.update(
        tag=tag,
        axis=concept_local(axis),
        raw_member_count=len(raw_facts),
        member_count=len(adjusted["members"]),
        segment_sum=adjusted["sum"],
        delta_pct=delta,
        strategy=adjusted["strategy"],
        members=adjusted["members"],
        leaf_members=adjusted["leaf_members"],
        subtotal_members_removed=adjusted["subtotal_members_removed"],
        elimination_members=adjusted["elimination_members"],
        bridge_members=adjusted.get("bridge_members", []),
        bridge_member_values=adjusted.get("bridge_member_values", {}),
        linkbase_member_coverage=adjusted["linkbase_member_coverage"],
        strategy_scores=adjusted["strategy_scores"],
        subset_alternatives=adjusted["subset_alternatives"],
        raw_member_values={member: value for member, value in sorted(raw_facts.items())},
        chart=chart_contract,
    )
    row["status"] = "AS_FILED" if delta < 0.5 else "NEEDS_REVIEW"
    if row["status"] == "NEEDS_REVIEW":
        alternative = reconciled_alternative_contract(
            candidates, selected_priority, ff.labels, consolidated_value
        )
        if alternative:
            row["alternative"] = alternative
    return row


def load_cik_map(fetcher: Fetcher) -> dict[str, str]:
    payload = json.loads(fetcher.get("https://www.sec.gov/files/company_tickers.json"))
    return {value["ticker"].upper(): str(value["cik_str"]).zfill(10) for value in payload.values()}


# --------------------------------------------------------------------------- corpus runner
def run(args: argparse.Namespace) -> list[dict]:
    """Corpus regression: latest 10-K/20-F, latest fiscal-year period, per ticker (as before)."""
    fetcher = Fetcher(args.user_agent, Path(args.cache_dir))
    cik_by_ticker = load_cik_map(fetcher)

    results: list[dict] = []
    requested_tickers = (
        [ticker.strip().upper() for ticker in args.tickers.split(",") if ticker.strip()]
        if args.tickers
        else TICKERS
    )
    for ticker in requested_tickers[: args.limit or None]:
        row: dict = {"ticker": ticker}
        try:
            cik = cik_by_ticker.get(ticker)
            if not cik:
                row.update(
                    status="NOT_FOUND",
                    reason="ticker is not present in the SEC company registry",
                )
                results.append(row)
                continue
            row["cik"] = cik
            submissions = json.loads(fetcher.get(f"https://data.sec.gov/submissions/CIK{cik}.json"))
            row["name"] = submissions["name"]
            filings = annual_filings(submissions, fetcher)
            if not filings:
                resolved = resolve_predecessor_by_file_number(submissions, cik, fetcher)
                if not resolved:
                    row.update(
                        status="NEEDS_ENTITY_RESOLUTION",
                        reason="mapped CIK has no annuals and no file-number predecessor resolved",
                    )
                    results.append(row)
                    continue
                resolved_cik, submissions, filings, file_number = resolved
                row.update(
                    mapped_cik=cik,
                    cik=resolved_cik,
                    name=submissions["name"],
                    entity_resolution="commission_file_number",
                    commission_file_number=file_number,
                )
                cik = resolved_cik
            form, accession, filed = filings[0]
            row.update(form=form, accn=accession, filed=filed)
            ff = parse_filing(fetcher, cik, form, accession, filed)
            row["linkbases"] = ff.linkbases
            if not ff.instance_name:
                row.update(status="UNAVAILABLE", reason="no XBRL instance in filing directory")
                results.append(row)
                continue
            row["currency"] = ff.currency
            periods = ff.periods(ANNUAL_DAYS)
            if not periods:
                row.update(status="UNAVAILABLE", reason="no fiscal-year revenue period")
                results.append(row)
                continue
            evaluated = evaluate_period(ff, periods[0])
            row.update(evaluated)
            results.append(row)
        except Exception as error:  # noqa: BLE001 - corpus runner records every failure
            row.update(status="ERROR", reason=f"{type(error).__name__}: {error}")
            results.append(row)
        time.sleep(args.request_pause)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def print_report(results: list[dict]) -> None:
    print("=" * 128)
    print(
        f"{'TKR':<6}{'FORM':<6}{'CUR':<5}{'STATUS':<29}{'RAW':>5}{'USE':>5}"
        f"{'SEG SUM':>14}{'CONSOL':>14}{'DELTA%':>9}  {'STRATEGY':<31}"
    )
    print("=" * 128)
    for row in results:

        def billions(key: str, row: dict = row) -> str:
            value = row.get(key)
            return f"{value / 1e9:,.1f}B" if isinstance(value, int | float) else "-"

        print(
            f"{row['ticker']:<6}{row.get('form', '-'):<6}{row.get('currency', '-'):<5}"
            f"{row.get('status', '?'):<29}{str(row.get('raw_member_count', '-')):>5}"
            f"{str(row.get('member_count', '-')):>5}{billions('segment_sum'):>14}"
            f"{billions('consolidated'):>14}{str(row.get('delta_pct', '-')):>9}  "
            f"{row.get('strategy', row.get('reason', ''))[:31]:<31}"
        )
    tally: dict[str, int] = defaultdict(int)
    for row in results:
        tally[row.get("status", "?")] += 1
    print("\n--- TALLY ---")
    for status, count in sorted(tally.items(), key=lambda item: -item[1]):
        print(f"  {status:<30} {count}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/sec-diagnostics/extraction_results.json")
    parser.add_argument("--cache-dir", default="data/sec-cache")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--tickers",
        default="",
        help="Optional comma-separated ticker override for focused runs.",
    )
    parser.add_argument("--request-pause", type=float, default=0.15)
    parser.add_argument(
        "--user-agent",
        default=os.environ.get("SEC_USER_AGENT"),
        help="SEC-compliant identifying User-Agent; do not place secrets in it.",
    )
    arguments = parser.parse_args()
    if not arguments.user_agent:
        parser.error("set SEC_USER_AGENT or pass --user-agent with an identifying contact")
    return arguments


def main() -> None:
    arguments = parse_args()
    print_report(run(arguments))


if __name__ == "__main__":
    main()
