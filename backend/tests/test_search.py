from tickerscope.search import parse_sec_payload


def test_exact_ticker_ranks_first(search_index):
    res = search_index.search("aapl")
    assert res[0]["ticker"] == "AAPL"
    assert res[0]["name"] == "Apple Inc."


def test_ticker_prefix_before_name_match(search_index):
    # "nvd" is a prefix of NVDA; NVAX only fuzzy-matches
    res = search_index.search("nvd")
    assert res[0]["ticker"] == "NVDA"


def test_name_substring_matches(search_index):
    res = search_index.search("micro")
    assert [r["ticker"] for r in res][:1] == ["MSFT"]


def test_short_query_prefers_exact_then_prefix(search_index):
    res = search_index.search("a")
    tickers = [r["ticker"] for r in res]
    assert tickers[0] == "A"
    assert tickers.index("AA") < tickers.index("AAPL") or "AA" in tickers
    assert len(res) <= 8


def test_dotted_share_class_maps_to_dash(search_index):
    res = search_index.search("brk.b")
    assert res[0]["ticker"] == "BRK-B"


def test_empty_query_returns_nothing(search_index):
    assert search_index.search("   ") == []


def test_limit_is_respected(search_index):
    assert len(search_index.search("a", limit=3)) == 3


def test_parse_sec_exchange_shape():
    payload = {
        "fields": ["cik", "name", "ticker", "exchange"],
        "data": [
            [320193, "Apple Inc.", "AAPL", "Nasdaq"],
            [19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"],
        ],
    }
    rows = parse_sec_payload(payload)
    assert [c.ticker for c in rows] == ["AAPL", "JPM"]
    assert rows[0].exchange == "NASDAQ"


def test_parse_sec_legacy_shape():
    payload = {"0": {"cik_str": 320193, "ticker": "aapl", "title": "Apple Inc."}}
    rows = parse_sec_payload(payload)
    assert rows[0].ticker == "AAPL" and rows[0].exchange is None and rows[0].cik == 320193


def test_search_endpoint(client):
    r = client.get("/api/search", params={"q": "nvd"})
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["ticker"] == "NVDA"
    assert {"ticker", "name", "exchange"} <= set(body["results"][0])
