"""One-off probe: print the yfinance shapes TickerScope depends on. Not used by the app."""

import json
import sys

import yfinance as yf

sym = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
t = yf.Ticker(sym)
info = t.info
keys = [
    "shortName",
    "longName",
    "symbol",
    "exchange",
    "fullExchangeName",
    "sector",
    "industry",
    "currentPrice",
    "regularMarketPrice",
    "regularMarketPreviousClose",
    "previousClose",
    "regularMarketChange",
    "regularMarketChangePercent",
    "regularMarketTime",
    "currency",
    "marketCap",
    "enterpriseValue",
    "fiftyTwoWeekLow",
    "fiftyTwoWeekHigh",
    "averageVolume",
    "averageVolume10days",
    "beta",
    "sharesOutstanding",
    "trailingPE",
    "forwardPE",
    "trailingPegRatio",
    "pegRatio",
    "priceToSalesTrailing12Months",
    "priceToBook",
    "enterpriseToEbitda",
    "enterpriseToRevenue",
    "totalRevenue",
    "revenueGrowth",
    "grossMargins",
    "operatingMargins",
    "profitMargins",
    "ebitda",
    "netIncomeToCommon",
    "trailingEps",
    "forwardEps",
    "returnOnEquity",
    "returnOnAssets",
    "operatingCashflow",
    "freeCashflow",
    "totalCash",
    "totalDebt",
    "debtToEquity",
    "currentRatio",
    "dividendYield",
    "trailingAnnualDividendYield",
    "dividendRate",
    "payoutRatio",
    "exDividendDate",
    "earningsTimestamp",
    "earningsTimestampStart",
    "fullTimeEmployees",
    "city",
    "country",
    "website",
    "longBusinessSummary",
]
print("=== info subset ===")
for k in keys:
    v = info.get(k)
    if k == "longBusinessSummary" and v:
        v = v[:80] + "..."
    print(f"{k}: {v!r}")
print("=== calendar ===")
try:
    print(t.calendar)
except Exception as e:  # noqa: BLE001
    print("calendar error", e)
print("=== income_stmt index (annual) ===")
inc = t.income_stmt
print(list(inc.index))
print("columns:", list(inc.columns))
print("=== quarterly_income_stmt columns ===")
q = t.quarterly_income_stmt
print("columns:", list(q.columns))
print("=== cashflow index ===")
print(list(t.cashflow.index))
print("=== history ===")
h = t.history(period="1y", auto_adjust=True)
print(h.tail(3))
print("fast_info:", json.dumps({k: str(v) for k, v in dict(t.fast_info).items()}, indent=0)[:600])
