# Smart Money V1

Adds a Smart Money layer to Weekly Range Scanner PRO.

V1:
- SEC insider activity (Forms 3/4/5 feed)
- Institutional 13F activity
- Congressional provider adapter
- Transparent 0–100 score
- Data-quality and as-of fields
- Detail view of underlying events

Limitations:
- Insider data follows SEC filing timing.
- 13F is quarterly and is not a real-time portfolio feed.
- Congressional disclosures can lag the transaction.
- The score is a research signal, not proof of superior information.

Worker configuration:
- SEC_USER_AGENT should identify the application and provide a contact email.
- TWELVE_DATA_API_KEY remains unchanged.

Options, ETF flows and ATS/dark-pool data are V2 adapters because they require separate data entitlements.
