# Muggle Investor：專案與系統架構設計

## Context

投資新手想讓手上的錢有更好的報酬，卻卡在兩件事上：
1. **資金怎麼用**：手上有一筆「大概」的錢，不知道該定期定額求穩，還是找報酬更高的機會，也不知道怎麼分配。
2. **看不懂市場**：台股大漲或大跌代表什麼？有沒有機會賺？專業人士說的話要怎麼理解？

Muggle Investor 是一個 PWA。同一份市場資料可以用「入門視角」（白話、比喻、跟你有什麼關係）或「專業視角」（原始指標、資金流、四象限）來看，每個專業名詞都能點開解釋，讓使用者從入門慢慢走到專業。資金規劃會依照使用者的狀況給出個人化的具體配置建議，並用歷史資料試算。

Repo 目前是空的（只有 README、LICENSE、.gitignore），這是一個從零開始的專案。

## 目標／非目標／反目標

- **目標（v1 兩者並重）**：(A) 看懂今天的市場，(B) 資金怎麼用（個人化配置＋試算）。
- **階段**：先給小圈子（自己與親友）使用，之後公開。架構要預留公開所需的擴充空間，但 v1 先從簡。
- **非目標（v1）**：下單／券商串接、即時逐筆報價、個股基本面分析、社群功能。
- **反目標**（就算功能能跑，出現這些也算失敗）：
  - LLM 自行編造數字或配置比例。所有數字都必須來自資料或確定性引擎，LLM 只負責「解釋」。
  - 根據內外盤差預測明日走勢。資料源明文禁止這麼做。
  - 新手看完反而更困惑。入門視角不能出現沒有解釋的術語。
  - API 金鑰外洩到前端。

## 已確認的決策（使用者指定）

- PWA；**vinext**（Cloudflare 的 Vite 版 Next.js API，最新版 1.1.0）、**TypeScript**、**Bun**、**Biome**、**shadcn/ui**、**Zod**。
- 程式碼品質要高，遵循軟體工程最佳實踐。
- **所有 dependencies 都用最新版**，以 `npm-check-updates`（`bunx npm-check-updates`）檢查。
- LLM 以 LLM 為主：只要能設定 **custom provider endpoint**（OpenAI 相容的 baseURL、apiKey、model）即可。
- 部署由使用者自行處理，預計是 **k8s 或 Vercel**，兩者都要支援。
- 資金模組提供**個人化的具體建議**（例如「這筆錢建議 60% 放 0050……」）。

## 資料源探勘結果（2026-10-11 實測）

| 來源 | 內容 | 格式／限制 | 用途 |
|---|---|---|---|
| darkfanxing `/api/digest/{key}` | 盤後摘要：台指期、上漲/下跌族群數、力度/面積、盤中節奏、漲跌幅前 10 族群、資金淨買/賣前 10、資金四象限、漲跌停、**詞彙表** | **HTML**（寫給 LLM 讀）、`x-ratelimit-limit: 10`、`no-store`、**金鑰在網址裡** | 每日解讀、資金流 |
| darkfanxing `/api/now/{key}` | 175 個 XQ 細產業族群：今日%、漲/跌/平家數、成交金額、金額排名、較昨日同時刻%、漲跌停數、近 1 月% | HTML table | 族群熱力圖 |
| darkfanxing `/api/now/{key}?group=X` | 單一族群的成分股：今日%、成交金額、近 1 月%、狀態 | HTML table | 族群明細 |
| TWSE `www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?stockNo=&date=` | 個股/ETF 月日線（民國年日期、千分位字串） | JSON、有限流 | 歷史價格 |
| TWSE OpenAPI `openapi.twse.com.tw/v1/...` | 全市場當日行情（`STOCK_DAY_ALL`）、休市日（`holidaySchedule`）等 | JSON | 標的清單、交易日曆 |
| FinMind `api.finmindtrade.com/api/v4/data` | `TaiwanStockPrice`、`TaiwanStockDividend` 等 | JSON；免 token 也可用（有限額），可設 token 提高額度 | **回測主要來源**（價格＋配息） |

**重要觀察**：
- darkfanxing 只提供「當天」資料，沒有歷史。所以**每天必須自己存快照**，才能累積趨勢與回顧。
- HTML 結構可能變動，解析要用 Zod 驗證，失敗時告警，並保留原始 HTML。原始 HTML 本身也是很好的 LLM context。
- 0050 等 ETF 有分割與配息（例如 0050 在 2025 年分割），回測必須用**還原（含息）報酬**，不能直接用收盤價。

## 系統架構

```
┌──────────── PWA（vinext / React / shadcn / Tailwind v4 / Service Worker）────────────┐
│  今日 │ 族群 │ 資金規劃 │ 問問看 │ 名詞                 全域「入門/專業」視角切換        │
│  IndexedDB：個人財務輪廓（local-first，不上傳伺服器保存）、最新解讀離線快取            │
└───────────────────────────────┬────────────────────────────────────────────────────┘
                                │ 只呼叫自己的 BFF（Route Handlers）
┌───────────────────────────────▼──────────── Server（同一個 vinext app）────────────────┐
│ api/market/*   讀 DB 快照（不直接打上游）    api/ask      LLM 串流問答（帶當日快照＋輪廓）  │
│ api/plan/*     配置引擎＋回測（確定性）       api/cron/ingest   受 secret 保護的排程入口   │
│                                                                                        │
│ modules: sources/  ingestion/  market/  insight(LLM)/  glossary/  planner/  config/     │
└──────┬──────────────────────────┬───────────────────────────────┬──────────────────────┘
       │                          │                               │
  Postgres（Drizzle）        上游資料源（限流＋重試）         OpenAI 相容 LLM endpoint
  快照/解讀/價格快取          darkfanxing / TWSE / FinMind      （AI SDK openai-compatible）
```

### 模組（deep modules，介面小、內部吸收複雜度）

1. **`config/`**：用 Zod 驗證 env（`DATABASE_URL`、`DARKFANXING_KEY`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`FINMIND_TOKEN?`、`CRON_SECRET`、`INVITE_CODES`）。啟動時就失敗，不要等到執行期才炸。
2. **`sources/`**：每個上游一個 adapter，形式為 `fetch → parse → zod validate → typed model`。
   - `darkfanxing/`：用 HTML parser（例如 `node-html-parser`）依 `<h2>` 區段解析 table，輸出 `DigestSnapshot`、`SectorBoard`、`SectorDetail`。共用的 token-bucket 限流加上指數退避。金鑰只存在 server。
   - `twse/`、`finmind/`：價格、配息、交易日曆；負責民國年與千分位的正規化。
3. **`ingestion/`**：排程任務。盤中（交易日 09:00–13:35，台北時間）每 N 分鐘抓 `/now`；收盤後抓 `/digest` 並觸發解讀生成；每日增量更新追蹤標的的價格與配息。不是交易日就跳過（休市日曆）。寫入的資料包含原始 HTML 與解析結果。
4. **`market/`**：讀取模型，也就是今日溫度（力度/面積 → 市場溫度計）、族群排行、資金四象限、族群明細（明細按需抓取，加 TTL 快取）。
5. **`insight/`（LLM）**：
   - Provider：AI SDK `@ai-sdk/openai-compatible`，用 config 的 baseURL/model 建立，可替換任何相容 endpoint。
   - **每日解讀**：收盤後批次為「入門」「專業」各生成一份，用結構化輸出（Zod schema：標題、發生什麼、為什麼重要、對你的意義、引用的名詞 id 列表），存 DB，所有使用者共用（控制成本）。
   - **問問看**：串流問答。context 包含當日快照、詞彙表、使用者輪廓（由請求帶入，不落地保存）、視角。system prompt 內建資料源的禁止事項，並要求「數字只能引用 context」。
   - Prompt 以檔案管理並版本化；輸出驗證失敗就重試或降級。
6. **`glossary/`**：在 repo 內策展的名詞庫（JSON/TS，用 Zod schema 驗證）。來源是 darkfanxing 的詞彙表加上常見投資名詞，每個名詞都有入門解釋、比喻、專業定義、相關名詞。UI 會把 LLM 輸出裡的名詞 id 轉成可點擊的名詞晶片。
7. **`planner/`（確定性、純函式、TDD）**：
   - **風險問卷** → `RiskProfile`（保守／穩健／平衡／積極／進取），依據包括年齡區間、投資期限、收入穩定度、緊急預備金、虧損承受度。
   - **配置引擎**：輸入是大概的金額（允許區間）、每月可投入金額、輪廓；輸出是**具體配置**：緊急預備金、核心（市值型 ETF，例如 0050/006208）、債券 ETF、（視輪廓）高股息、衛星部位（可連結 market 模組裡「強勢」族群作為機會觀察，附風險提示），並給出單筆或定期定額的建議節奏。**比例由規則表決定，LLM 只負責解釋。**
   - **試算／回測**：比較單筆、定期定額、建議配置在歷史期間的 CAGR、最大回撤、波動度、最差一年、總投入與期末市值。使用含息還原價。
   - 標的池：一份策展的 `instruments.ts`（代號、類型、費用率、說明），規則表引用它。
8. **存取控制（v1）**：邀請碼加上簽章 cookie，用來保護 LLM 成本。公開前再換成正式帳號系統。

### 資料表（Drizzle，草案）
`market_snapshots`（kind: digest/now/group、trade_date、captured_at、raw_html、parsed jsonb、schema_version）、`briefings`（trade_date、lens、prompt_version、model、content jsonb）、`price_bars`（symbol、date、ohlc、adj_close）、`dividends`、`trading_calendar`、`llm_usage`（成本追蹤）。

### PWA
Manifest 與圖示、Service Worker（優先使用 Serwist 的 Vite 整合，不相容時退回 `vite-plugin-pwa`），快取策略為 app shell、最新解讀、名詞庫 stale-while-revalidate。支援安裝提示。推播通知（「盤後解讀已出爐」）放到後續階段。

### 不定期使用（使用者來訪頻率不固定）
使用者可能隔幾天甚至幾週才打開一次，設計上不能假設他們每天都看：
- **「你不在的這段期間」回顧**：裝置端記錄上次來訪時間（IndexedDB）。超過 1 個交易日沒來時，「今日」頁最上方先顯示期間回顧，內容包括大盤累計變化、資金流向的轉變、四象限的換手，分入門與專業兩種視角，接著才是今天的內容。
- **回顧摘要的成本**：每週由後端批次產生週摘要並共用；來訪間隔不到一週時，拼接每日解讀的重點。不為個別使用者呼叫 LLM（「問問看」除外）。
- **歷史完整保存**：不論有沒有人上線，每個交易日都由排程存下盤後摘要與族群收盤快照。盤中快照可以在 30 天後只保留每日最後一筆（保存策略在後續階段實作）。
- **資料日期一律標示**：離線快取或非當日的資料都清楚寫出資料日期。
- **不假設使用者記得**：入門視角每次都附名詞晶片。
- **推播**：改成「重大變化」才通知（例如大盤單日波動超過門檻），不做每日推播。屬於後續階段。

### UI 主要畫面
- **今日**：（久未來訪時先顯示期間回顧）市場溫度計、一句話總結、入門/專業解讀、領漲領跌族群、資金流向卡片。
- **族群**：175 族群熱力圖或排行，點進去看成分股，可切換顯示四象限。
- **資金規劃**：問卷 → 個人化配置（圓餅圖加每一項的理由）→ 試算比較圖 → 可調參數。
- **問問看**：聊天介面，帶入「今天」的 context，並提供建議問題。
- **名詞**：可搜尋的名詞庫。
- 圖表使用 shadcn charts（Recharts）。

### 部署
- vinext 透過 **Nitro**：`node-server` preset 打包成 Docker image 給 **k8s** 用（Deployment 加 CronJob 呼叫 `/api/cron/ingest`）；`vercel` preset 給 **Vercel** 用（Vercel Cron）。兩者共用同一套程式碼，差別只在 build preset。
- Postgres：k8s 上自架或使用託管服務；Vercel 搭配 Neon 等。
- 提供 `/api/health`，使用結構化 log。

### 工程品質
- TS `strict`。Biome 負責 lint 與 format。Vitest 負責單元與整合測試，搭配 Playwright 做 e2e。
- **以實測抓下的 HTML 作為 parser 的 fixtures**。
- GitHub Actions：`biome ci`、`tsc --noEmit`、測試、build。
- `bunx npm-check-updates` 作為 script（`deps:check`），初始化時就把所有套件升到最新。
- 目前查到的最新版本：vinext 1.1.0、vite 8.3.4、ai 7.0.137、@ai-sdk/openai-compatible 3.0.67、zod 4.6.5、@biomejs/biome 2.5.15、tailwindcss 4.3.3、drizzle-orm 0.45.4、serwist 9.5.13。實作時仍以 ncu 為準。

## 風險與因應

| 風險 | 因應 |
|---|---|
| vinext 還很新，官方自己也說「並非所有應用都能直接替換」，而且 Nitro 的 Node 部署缺少文件 | **Phase 0 先做 spike**：驗證 Route Handler 串流、Nitro node-server、Service Worker、Bun 能否一起運作。不行的話退回 Next.js 16（API 相同，切換成本低） |
| darkfanxing 的 HTML 格式變動 | 用 Zod 驗證、保留原始 HTML、解析失敗時告警並沿用上一份快照 |
| 上游限流（10 次/視窗，視窗長度未知） | Phase 0 實測視窗長度。只有 ingestion 會打上游，使用者一律讀 DB |
| LLM 數字幻覺 | 數字只來自 context 與引擎，輸出經 schema 驗證 |
| 個人化建議的法規風險（投顧規範） | 小圈子階段加上明確免責聲明。**公開前把這項列為上線門檻**，重新檢視法規，必要時用 feature flag 改成「範例配置」 |
| 使用者的財務資料很敏感 | 預設只存在裝置（IndexedDB），伺服器不保存 |

## 分階段路線（v1 = Phase 0–4）

0. **Scaffold 與 spike**：建立 vinext、Bun、Biome、Tailwind、shadcn、Vitest、CI；完成 env schema；完成 vinext × Nitro × PWA × 串流的可行性驗證；實測上游限流。
1. **資料層**：三個 adapter 加 parser（含 fixtures 測試）、DB schema、ingestion 排程、交易日曆。
2. **看懂市場**：每日雙視角解讀、週摘要、「你不在的這段期間」回顧、今日頁、族群頁、名詞庫與名詞晶片。
3. **資金怎麼用**：問卷、配置引擎、回測引擎（TDD）、規劃頁與 LLM 解釋。
4. **問問看與 PWA 收尾**：串流問答、離線快取、安裝、邀請碼。
5. **公開前**（v1 之後）：帳號系統、法規審視與免責設計、LLM 成本控管與用量限制、推播。

實作開始時，先把這份設計寫進 `docs/superpowers/specs/2026-10-11-muggle-investor-design.md` 並 commit，再用 writing-plans 展開成逐步實作計畫。

## 由我決定的事項（請確認）
1. **配置比例表與問卷計分**：Phase 3 開始前由我先擬一份草案（5 級風險輪廓對應緊急預備金、核心、債券、高股息、衛星的比例，以及 `instruments.ts` 標的池），**你簽核後才寫進引擎**。規則表放在獨立檔案，附單元測試，方便日後調整。
2. **排程與平台脫鉤**：`/api/cron/ingest` 接受任何排程器觸發，包括 k8s CronJob、Vercel Cron（Pro）或 GitHub Actions。Vercel Hobby 的 cron 一天只能跑一次，那種情況就改用外部排程器。
3. **含息還原價自己算**：用 FinMind（或 TWSE）的原始價、配息、分割資料自行計算還原報酬，做成確定性模組並附測試。FinMind token 設為選填，只用來提高額度，不依賴付費資料集。
4. **LLM 結構化輸出要有降級路徑**：endpoint 支援 JSON schema 就直接用；不支援時，改用「JSON 指令加 Zod 驗證，失敗就修復並重試」。串流也要容許 endpoint 不支援的情況。
5. **Fixtures**：本次探勘抓下的 2026-10-08 digest/now/group（石英元件）HTML 會在 Phase 1 放進 `test/fixtures/darkfanxing/`。上游網域是 `stocks.darkfanxing.com`，金鑰走 env。
6. **公開前的門檻新增一項**：確認 darkfanxing 與 FinMind 的使用條款是否允許儲存資料、轉給其他使用者看。小圈子階段先照現狀使用。
7. 測試框架選 Vitest（與 Vite 整合），HTML parser 選 `node-html-parser`，log 選 pino。

## 驗證方式
- Parser：用 2026-10-08 實際抓下的 digest/now/group HTML 當 fixtures，斷言族群數 175、指標值正確。
- Planner：純函式單元測試，包含已知期間 0050 定期定額的手算對照，以及分割、配息正確性的測試。
- 端到端：`bun run dev` 後用 Playwright 走一遍「今日 → 點名詞 → 族群明細 → 問卷 → 配置 → 試算 → 問問看」。
- 部署：`docker build` 後在本機以 Node 執行 Nitro 輸出，確認可以 build 成 Vercel preset，SW 可註冊，並通過 Lighthouse 的 PWA 檢查。
- CI 全綠，`bunx npm-check-updates` 沒有可升級的項目。
