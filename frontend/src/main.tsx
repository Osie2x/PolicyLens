import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  BookOpen,
  FlaskConical,
  ShieldCheck,
  Settings,
  Layers,
  Activity,
  ChevronDown,
  Check,
  X,
  FileText,
  Plus,
  Command,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Minus,
  AlertTriangle,
  Download,
  Clock,
  Sparkles,
  Menu,
  Upload,
  CircleHelp,
  CheckCheck,
  Quote,
  LoaderCircle,
} from "lucide-react";
import "./styles.css";

type Doc = {
  id: string;
  title: string;
  text?: string;
  version: string;
  date: string | null;
  page: number | null;
  source_url: string;
  sha256: string;
  characters?: number;
  chunks?: number;
};
type Chunk = {
  id: string;
  document_id: string;
  title: string;
  text: string;
  start: number;
  end: number;
  section: string;
  version: string;
  source_url: string;
};
type Evidence = {
  chunk: Chunk;
  score: number;
  lexical_score: number;
  dense_score: number;
};
type Answer = {
  request_id: string;
  status: string;
  answer: string;
  claims: { text: string; citation_id: string }[];
  evidence: Evidence[];
  route: string;
  provider: string;
  strategy: string;
  cached: boolean;
  latency_ms: number;
  retrieval_ms: number;
  corpus_version: string;
};
type Run = {
  name: string;
  n: number;
  positive_n: number;
  recall_at_5: number;
  mrr: number;
  ndcg_at_5: number;
  gold_span_recall_at_5: number;
  answer_token_f1: number;
  citation_precision: number;
  citation_precision_n: number;
  quote_groundedness: number;
  answer_coverage: number;
  abstention_accuracy: number;
  absent_clause_refusal: number;
  control_refusal: number;
  latency_ms: { p50: number; p95: number; p99: number };
  failure_counts: Record<string, number>;
};
type Report = {
  runs: Run[];
  questions: number;
  documents: number;
  chunks: number;
  created_at: string;
  corpus_version: string;
  limitations: string[];
  scope: string;
  embedding_model: string;
  cached_latency_ms?: { p50: number; p95: number; p99: number };
};
type Failure = {
  strategy: string;
  class: string;
  id: string;
  question: string;
  document_id: string;
  token_f1: number;
  status: string;
};
type Demo = {
  documents: Doc[];
  report: Report;
  failures: Failure[];
  examples: { question: string; document_id: string; answer: Answer }[];
};
type Page = "ask" | "documents" | "experiments" | "failures" | "guide";
const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const label = (s: string) =>
  s.replaceAll("_", " ").replace("+rerank", " + rerank");
const shortTitle = (s: string) =>
  s.replace(/_\d{2}_\d{2}_\d{4}-EX-[^-]+-/, " · ").replaceAll("_", " ");
const icons = {
  ask: Search,
  documents: BookOpen,
  experiments: FlaskConical,
  failures: ShieldCheck,
  guide: CircleHelp,
};
const titles = {
  ask: "Ask PolicyLens",
  documents: "Source library",
  experiments: "Evaluation lab",
  failures: "Failure analysis",
  guide: "How it works",
};
function App() {
  const [page, setPage] = useState<Page>("ask");
  const [demo, setDemo] = useState<Demo | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [mode, setMode] = useState<"loading" | "live" | "offline">("loading");
  const [query, setQuery] = useState("");
  const [docId, setDocId] = useState("");
  const [strategy, setStrategy] = useState("hybrid");
  const [rerank, setRerank] = useState(false);
  const [rerankAvailable, setRerankAvailable] = useState(false);
  const [askedDocId, setAskedDocId] = useState("");
  const [telemetry, setTelemetry] = useState<{
    counters: Record<string, number>;
    latency_ms: Record<string, number | null>;
    window: number;
  } | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState(0);
  const [source, setSource] = useState<Doc | null>(null);
  const [filter, setFilter] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [history, setHistory] = useState<
    { question: string; answer: Answer }[]
  >([]);
  const [failureClass, setFailureClass] = useState("all");
  const [metric, setMetric] = useState<
    "recall_at_5" | "mrr" | "answer_token_f1"
  >("recall_at_5");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  const input = useRef<HTMLTextAreaElement>(null);
  const headers = () => ({
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  });
  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...headers(), ...options.headers },
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ detail: "Service unavailable" }));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    return response.json();
  }
  useEffect(() => {
    let alive = true;
    async function load() {
      let snapshot: Demo | null = null;
      try {
        snapshot = await (await fetch("./demo.json")).json();
        if (alive) {
          setDemo(snapshot);
          setReport(snapshot!.report);
        }
      } catch {}
      try {
        const response = await fetch("/health");
        if (!response.ok) throw new Error("Offline");
        const health = await response.json();
        if (!alive) return;
        setMode("live");
        setRerankAvailable(health.reranker_enabled);
        try {
          const d = await api("/api/documents");
          if (alive) {
            setDocs(d);
            setDocId(d[0]?.id || "");
          }
        } catch (e) {
          setError(String(e));
        }
        try {
          const r = await api("/api/experiments");
          if (alive && r.runs?.length) setReport(r);
        } catch {}
      } catch {
        if (alive) {
          setMode("offline");
          setDocs(snapshot?.documents || []);
          setDocId(
            snapshot?.examples[0]?.document_id ||
              snapshot?.documents[0]?.id ||
              "",
          );
        }
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("ask");
        input.current?.focus();
      }
      if (e.key === "Escape") {
        setSource(null);
        setSettingsOpen(false);
        setUploadOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  function navigate(p: Page) {
    setPage(p);
    setMobileOpen(false);
    setFilter("");
  }
  async function ask(question = query, scope = docId) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    setAnswer(null);
    setAsked(question);
    setAskedDocId(scope);
    setQuery(question);
    setSelectedEvidence(0);
    setPage("ask");
    setPhase("Retrieving and verifying evidence");
    try {
      let result: Answer;
      if (mode === "offline") {
        const example = demo?.examples.find(
          (e) => e.question === question && e.document_id === scope,
        );
        if (!example)
          throw new Error(
            "This is an offline preview. Choose a recorded example below, or start the API to ask new questions.",
          );
        result = example.answer;
      } else {
        const response = await fetch("/api/query/stream", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            question,
            document_id: scope || null,
            strategy,
            rerank,
            top_k: 5,
          }),
        });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.detail);
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let final: Answer | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const type = event.match(/event: (.+)/)?.[1];
            const data = JSON.parse(event.match(/data: (.+)/)?.[1] || "{}");
            if (type === "phase")
              setPhase("Searching sources · verifying exact quotes");
            if (type === "error") throw new Error(data.detail);
            if (type === "answer") final = data;
          }
        }
        if (!final)
          throw new Error("The stream ended before a verified answer arrived.");
        result = final;
      }
      setAnswer(result);
      setHistory((h) => [{ question, answer: result }, ...h].slice(0, 8));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      setPhase("");
    }
  }
  async function openSource(doc: string) {
    setError("");
    try {
      const sourceDoc =
        mode === "offline"
          ? docs.find((d) => d.id === doc)
          : await api(`/api/documents/${doc}`);
      setSource(sourceDoc || null);
    } catch (e) {
      setError(String(e));
    }
  }
  async function rate(rating: string) {
    if (!answer) return;
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ request_id: answer.request_id, rating }),
      });
      setFeedback(rating);
    } catch (e) {
      setError(String(e));
    }
  }
  async function reconnect() {
    try {
      const health = await api("/health");
      const d = await api("/api/documents");
      setMode("live");
      setDocs(d);
      setDocId(d[0]?.id || "");
      setRerankAvailable(health.reranker_enabled);
      setSettingsOpen(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const file = data.get("file") as File;
    try {
      let result;
      if (file?.size) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/ingestion/pdf", {
          method: "POST",
          headers: { "X-Admin-Key": adminKey },
          body,
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.detail);
      } else {
        result = await api("/api/ingestion", {
          method: "POST",
          headers: { "X-Admin-Key": adminKey },
          body: JSON.stringify({
            title: data.get("title"),
            text: data.get("text"),
            version: "1",
          }),
        });
      }
      setJobId(result.job_id);
      setJobStatus(
        "Queued — the ingestion worker will parse and index this document.",
      );
    } catch (e) {
      setError(String(e));
    }
  }
  async function checkJob() {
    try {
      const job = await api(`/api/jobs/${jobId}`, {
        headers: { "X-Admin-Key": adminKey },
      });
      setJobStatus(`${job.status}${job.error ? ": " + job.error : ""}`);
      if (job.status === "completed") {
        const d = await api("/api/documents");
        setDocs(d);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  const baseline = report?.runs.find((r) => r.name === "hybrid");
  const failures = demo?.failures || [];
  const filteredFailures = failures.filter(
    (f) =>
      (failureClass === "all" || f.class === failureClass) &&
      f.question.toLowerCase().includes(filter.toLowerCase()),
  );
  const classes = [...new Set(failures.map((f) => f.class))];
  const current = answer?.evidence[selectedEvidence];
  async function refreshMetrics() {
    try {
      setTelemetry(await api("/api/metrics"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (page === "experiments" && mode === "live") void refreshMetrics();
  }, [page, mode]);
  useEffect(() => {
    if (!source && !settingsOpen && !uploadOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector(".modal") as HTMLElement | null;
    const controls = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button,a[href],input,textarea,select",
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    controls()[0]?.focus();
    if (source)
      modal?.querySelector("mark")?.scrollIntoView({ block: "center" });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = controls();
      const first = list[0],
        last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [source, settingsOpen, uploadOpen]);
  function download() {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "policylens-benchmark.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() => {
            setAnswer(null);
            setQuery("");
            setError("");
            navigate("ask");
          }}
        >
          <span className="brand-icon">
            <Search size={23} />
          </span>
          PolicyLens<span className="brand-period">.</span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">PL</span>
          <span>
            Research workspace<small>Personal project</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(Object.keys(titles) as Page[]).map((p) => {
            const Icon = icons[p];
            return (
              <button
                key={p}
                className={page === p ? "active" : ""}
                onClick={() => navigate(p)}
              >
                <Icon size={18} />
                {titles[p]}
                {p === "ask" && <kbd>⌘ K</kbd>}
                {p === "documents" && (
                  <span className="nav-count">{docs.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="nav-label collections-label">
          COLLECTION{" "}
          <button
            aria-label="Add documents"
            onClick={() => setUploadOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <button className="collection" onClick={() => navigate("documents")}>
          <span>
            <Layers size={16} />
          </span>
          <div>
            Atticus contracts<small>CUAD v1 · CC BY 4.0</small>
          </div>
          <span className="collection-dot" />
        </button>
        {history.length > 0 && (
          <>
            <div className="nav-label">RECENT QUESTIONS</div>
            <div className="history">
              {history.slice(0, 3).map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setAsked(h.question);
                    setAskedDocId(
                      h.answer.evidence[0]?.chunk.document_id || "",
                    );
                    setAnswer(h.answer);
                    setSelectedEvidence(0);
                    navigate("ask");
                  }}
                >
                  <Clock size={13} />
                  <span>{h.question}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="trust-note">
            <ShieldCheck size={20} />
            <strong>Evidence, not guesswork.</strong>
            <p>
              Every answer starts with a source. Unsupported claims stay out.
            </p>
            <button onClick={() => navigate("guide")}>
              Explore the architecture <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={17} />
            Connection settings
          </button>
          <div className="profile">
            <span>OI</span>
            <div>
              Osaretin Igbinoba<small>PolicyLens workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Toggle navigation"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{titles[page]}</strong>
          </div>
          <div className="top-actions">
            <span className={`status-dot ${mode === "live" ? "green" : ""}`} />
            <span>
              {mode === "live"
                ? "API connected"
                : mode === "loading"
                  ? "Connecting…"
                  : "Offline preview"}
            </span>
            <span className="top-divider" />
            <a
              href="https://github.com/Osie2x/PolicyLens"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <ArrowUpRight size={14} />
            </a>
          </div>
        </header>
        <main className={page === "ask" ? "ask-main" : "content-main"}>
          {mode === "offline" && (
            <div className="preview-banner">
              <BookOpen size={15} />
              <span>
                Recorded preview · real benchmark results and saved answers.
                Start the API for live retrieval.
              </span>
              <button onClick={() => setSettingsOpen(true)}>
                Connect <ArrowRight size={13} />
              </button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {page === "ask" && (
            <>
              {!answer && !busy && (
                <section className="hero">
                  <div className="hero-eyebrow">
                    <span />
                    <span>SOURCE-GROUNDED INTELLIGENCE</span>
                  </div>
                  <h1>
                    Clarity, backed
                    <br />
                    by <span>evidence.</span>
                    <svg viewBox="0 0 250 20" aria-hidden="true">
                      <path d="M4 13C63 1 157 0 244 12" />
                    </svg>
                  </h1>
                  <p>
                    Ask your documents a question.
                    <br />
                    Get an answer you can trace, verify, and trust.
                  </p>
                  <div className="orb" aria-hidden="true">
                    <svg viewBox="0 0 200 200">
                      <defs>
                        <radialGradient id="sphere">
                          <stop stopColor="#d8ebbe" />
                          <stop offset=".7" stopColor="#bdd9c8" />
                          <stop offset="1" stopColor="#7da997" />
                        </radialGradient>
                        <clipPath id="circle">
                          <circle cx="100" cy="100" r="75" />
                        </clipPath>
                      </defs>
                      <circle cx="100" cy="100" r="76" fill="url(#sphere)" />
                      <g
                        clipPath="url(#circle)"
                        fill="none"
                        stroke="#356c58"
                        strokeOpacity=".36"
                        strokeWidth=".7"
                      >
                        {Array.from({ length: 13 }, (_, i) => (
                          <ellipse
                            key={i}
                            cx="100"
                            cy="100"
                            rx={10 + i * 6}
                            ry="75"
                            transform="rotate(-32 100 100)"
                          />
                        ))}
                        {Array.from({ length: 13 }, (_, i) => (
                          <ellipse
                            key={i}
                            cx="100"
                            cy={28 + i * 12}
                            rx="78"
                            ry="16"
                            transform="rotate(-32 100 100)"
                          />
                        ))}
                      </g>
                      <circle
                        cx="100"
                        cy="100"
                        r="92"
                        fill="none"
                        stroke="#b6c6b9"
                        strokeWidth=".6"
                        strokeDasharray="2 5"
                      />
                      <circle cx="174" cy="48" r="7" fill="#255f49" />
                      <path
                        d="M171 48l2 2 4-5"
                        fill="none"
                        stroke="white"
                        strokeWidth="1.6"
                      />
                    </svg>
                    <span>
                      <ShieldCheck size={13} /> VERIFIABLE BY DESIGN
                    </span>
                  </div>
                </section>
              )}
              {(answer || busy) && (
                <div className="result-heading">
                  <div className="eyebrow">EVIDENCE WORKSPACE</div>
                  <h1>{asked}</h1>
                  <p>
                    {docs.find((d) => d.id === askedDocId)?.title &&
                      shortTitle(docs.find((d) => d.id === askedDocId)!.title)}
                  </p>
                </div>
              )}
              <section className="query-panel">
                <div className="query-input">
                  <Search size={21} />
                  <textarea
                    ref={input}
                    aria-label="Ask a policy question"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void ask();
                      }
                    }}
                    placeholder="What would you like to know about your contracts?"
                    rows={2}
                  />
                  <button
                    className="send"
                    disabled={busy || !query.trim() || mode === "loading"}
                    onClick={() => void ask()}
                    aria-label="Search source documents"
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={21} />
                    ) : (
                      <ArrowRight size={22} />
                    )}
                  </button>
                </div>
                <div className="query-options">
                  <label>
                    <Layers size={15} />
                    <select
                      aria-label="Select contract"
                      value={docId}
                      onChange={(e) => setDocId(e.target.value)}
                    >
                      <option value="">Choose a contract</option>
                      {docs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {shortTitle(d.title).slice(0, 75)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <div className="query-options-right">
                    <select
                      aria-label="Retrieval strategy"
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      disabled={mode === "offline"}
                    >
                      <option value="hybrid">Hybrid search</option>
                      <option value="bm25">BM25</option>
                      <option value="dense">Dense search</option>
                    </select>
                    <label
                      className="rerank-toggle"
                      title={
                        !rerankAvailable
                          ? "Enable POLICYLENS_ENABLE_RERANKER on the backend"
                          : "Rerank the top 20 results"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={rerank}
                        onChange={(e) => setRerank(e.target.checked)}
                        disabled={!rerankAvailable || mode === "offline"}
                      />
                      Rerank
                    </label>
                  </div>
                </div>
              </section>
              {busy && (
                <div className="loading-panel" role="status">
                  <LoaderCircle className="spin" size={23} />
                  <strong>{phase}</strong>
                  <p>Only verified claims will appear in the answer.</p>
                </div>
              )}
              {answer && (
                <div className="answer-layout">
                  <section className="answer-card">
                    <div className="answer-card-heading">
                      <span
                        className={
                          answer.status === "answered"
                            ? "verified-badge"
                            : "refused-badge"
                        }
                      >
                        {answer.status === "answered" ? (
                          <CheckCheck size={15} />
                        ) : (
                          <ShieldCheck size={15} />
                        )}{" "}
                        {answer.status === "answered"
                          ? "Exact quotes verified"
                          : answer.status === "clarify"
                            ? "Clarification needed"
                            : "No supported answer"}
                      </span>
                      <span>
                        {mode === "offline" ? "Recorded · " : ""}
                        {answer.latency_ms.toFixed(0)} ms
                      </span>
                    </div>
                    <h2>
                      {answer.status === "answered"
                        ? "What the sources say"
                        : "Evidence boundary"}
                    </h2>
                    {answer.claims.length ? (
                      answer.claims.map((claim, i) => (
                        <div className="claim" key={i}>
                          <Quote size={17} />
                          <div>
                            <p>{claim.text}</p>
                            <button
                              className="citation"
                              onClick={() =>
                                setSelectedEvidence(
                                  Math.max(
                                    0,
                                    answer.evidence.findIndex(
                                      (e) => e.chunk.id === claim.citation_id,
                                    ),
                                  ),
                                )
                              }
                            >
                              <FileText size={12} />
                              {claim.citation_id}
                              <ArrowUpRight size={11} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="refusal-text">{answer.answer}</p>
                    )}
                    <div className="verification-note">
                      <ShieldCheck size={16} />
                      <span>
                        Verbatim support checked against retrieved text.
                        Relevance and completeness still need review.
                      </span>
                    </div>
                    <div className="answer-footer">
                      <div>
                        <span>{label(answer.strategy)}</span>
                        <span>{answer.provider.replaceAll("_", " ")}</span>
                        <span>{answer.cached ? "Cache hit" : "Uncached"}</span>
                      </div>
                      <div className="feedback">
                        {feedback ? (
                          <small>
                            Feedback saved <Check size={12} />
                          </small>
                        ) : (
                          <>
                            <span>Useful?</span>
                            {(["correct", "partial", "incorrect"] as const).map(
                              (r, i) => {
                                const Icon = [ThumbsUp, Minus, ThumbsDown][i];
                                return (
                                  <button
                                    key={r}
                                    aria-label={`Rate ${r}`}
                                    disabled={mode === "offline"}
                                    onClick={() => void rate(r)}
                                    title={
                                      mode === "offline"
                                        ? "Connect API to save feedback"
                                        : r
                                    }
                                  >
                                    <Icon size={14} />
                                  </button>
                                );
                              },
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </section>
                  <aside className="evidence-panel">
                    <div className="section-heading">
                      <h3>Retrieved evidence</h3>
                      <span>{answer.evidence.length} passages</span>
                    </div>
                    {answer.evidence.map((e, i) => (
                      <button
                        key={e.chunk.id}
                        className={`evidence-item ${i === selectedEvidence ? "selected" : ""}`}
                        onClick={() => setSelectedEvidence(i)}
                      >
                        <span className="evidence-index">{i + 1}</span>
                        <div>
                          <strong>{e.chunk.section}</strong>
                          <small>
                            {shortTitle(e.chunk.title).slice(0, 62)}
                          </small>
                        </div>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                    {current && (
                      <div className="evidence-detail">
                        <span className="eyebrow">SOURCE PASSAGE</span>
                        <p>{current.chunk.text}</p>
                        <div className="source-meta">
                          <span>
                            Version <strong>{current.chunk.version}</strong>
                          </span>
                          <span>
                            Text offsets{" "}
                            <strong>
                              {current.chunk.start}–{current.chunk.end}
                            </strong>
                          </span>
                          <span>
                            Dense similarity{" "}
                            <strong>{current.dense_score.toFixed(3)}</strong>
                          </span>
                          <span>
                            BM25 score{" "}
                            <strong>{current.lexical_score.toFixed(2)}</strong>
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() =>
                            void openSource(current.chunk.document_id)
                          }
                        >
                          View original document <ExternalLink size={13} />
                        </button>
                      </div>
                    )}
                  </aside>
                </div>
              )}
              {!answer && !busy && (
                <>
                  <div className="suggestions">
                    <span>
                      {mode === "offline"
                        ? "TRY A RECORDED QUESTION"
                        : "A FEW PLACES TO START"}
                    </span>
                    <div>
                      {mode === "offline"
                        ? demo?.examples.slice(0, 3).map((e, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setDocId(e.document_id);
                                void ask(e.question, e.document_id);
                              }}
                            >
                              {e.question}
                              <ArrowUpRight size={15} />
                            </button>
                          ))
                        : [
                            "What does this contract say about termination for convenience?",
                            "What does this contract say about governing law?",
                            "What does this contract say about exclusivity?",
                          ].map((q) => (
                            <button key={q} onClick={() => void ask(q)}>
                              {q}
                              <ArrowUpRight size={15} />
                            </button>
                          ))}
                    </div>
                  </div>
                  <div className="workspace-overview">
                    <div className="section-heading">
                      <h3>A workspace built for trust</h3>
                      <button onClick={() => navigate("experiments")}>
                        Explore evaluations <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="overview-grid">
                      <div>
                        <span className="tile-icon">
                          <BookOpen size={19} />
                        </span>
                        <span className="tile-label">SOURCE COLLECTION</span>
                        <strong>
                          {docs.length}
                          <small>public contracts</small>
                        </strong>
                        <p>
                          Real CUAD documents, versioned
                          <br />
                          with exact text provenance.
                        </p>
                        <button onClick={() => navigate("documents")}>
                          Browse sources <ArrowRight size={14} />
                        </button>
                      </div>
                      <div>
                        <span className="tile-icon">
                          <FlaskConical size={19} />
                        </span>
                        <span className="tile-label">MEASURED RETRIEVAL</span>
                        <strong>
                          {percent(baseline?.recall_at_5)}
                          <small>Recall@5</small>
                        </strong>
                        <p>
                          Hybrid search on {baseline?.positive_n || "—"}{" "}
                          positive labels.
                          <br />
                          View the full benchmark and limits.
                        </p>
                        <button onClick={() => navigate("experiments")}>
                          Inspect results <ArrowRight size={14} />
                        </button>
                      </div>
                      <div>
                        <span className="tile-icon">
                          <ShieldCheck size={19} />
                        </span>
                        <span className="tile-label">EVIDENCE BOUNDARY</span>
                        <strong>
                          Quote-first<small>verification</small>
                        </strong>
                        <p>
                          Unsupported claims are withheld.
                          <br />
                          No invented dates or page numbers.
                        </p>
                        <button onClick={() => navigate("guide")}>
                          See the safeguards <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {page === "documents" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR KNOWLEDGE, TRACEABLE</div>
                  <h1>The source of truth.</h1>
                  <p>
                    32 reproducibly sampled public contracts from the Atticus
                    dataset.
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setUploadOpen(true)}
                >
                  <Plus size={16} />
                  Add source
                </button>
              </div>
              <div className="library-summary">
                <BookOpen size={22} />
                <div>
                  <strong>Atticus Open Contract Dataset</strong>
                  <span>
                    Kaggle · CUAD v1 · The Atticus Project · CC BY 4.0
                  </span>
                </div>
                <a
                  href="https://www.kaggle.com/datasets/konradb/atticus-open-contract-dataset-aok-beta"
                  target="_blank"
                  rel="noreferrer"
                >
                  View dataset <ExternalLink size={14} />
                </a>
              </div>
              <div className="toolbar">
                <div className="filter-input">
                  <Search size={16} />
                  <input
                    aria-label="Filter documents"
                    placeholder="Find a contract…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <span>
                  {
                    docs.filter((d) =>
                      d.title.toLowerCase().includes(filter.toLowerCase()),
                    ).length
                  }{" "}
                  documents
                </span>
              </div>
              <div className="document-grid">
                {docs
                  .filter((d) =>
                    d.title.toLowerCase().includes(filter.toLowerCase()),
                  )
                  .map((d) => (
                    <article className="document-card" key={d.id}>
                      <div>
                        <span className="document-icon">
                          <FileText size={21} />
                        </span>
                        <span className="document-version">{d.version}</span>
                      </div>
                      <h3>{shortTitle(d.title)}</h3>
                      <p>
                        {((d.characters || d.text?.length || 0) / 1000).toFixed(
                          1,
                        )}
                        k characters ·{" "}
                        {d.chunks
                          ? `${d.chunks} passages`
                          : "Public source text"}
                      </p>
                      <div>
                        <button onClick={() => void openSource(d.id)}>
                          Read source <ArrowUpRight size={13} />
                        </button>
                        <button
                          onClick={() => {
                            setDocId(d.id);
                            navigate("ask");
                            input.current?.focus();
                          }}
                        >
                          Ask <ArrowRight size={13} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              <p className="muted-note">
                Page numbers and publication dates are unavailable in the text
                export. Citations use exact character offsets.
              </p>
            </>
          )}
          {page === "experiments" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MEASURE. COMPARE. UNDERSTAND.</div>
                  <h1>Trust is a measurable thing.</h1>
                  <p>
                    Four retrieval configurations. One reproducible evidence
                    benchmark.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={download}
                  disabled={!report}
                >
                  <Download size={15} />
                  Export results
                </button>
              </div>
              <div className="metric-grid">
                <Metric
                  icon={<FlaskConical size={18} />}
                  title="Evaluation cases"
                  value={String(report?.questions || "—")}
                  detail="200 expert-derived · 40 controls"
                />
                <Metric
                  icon={<Layers size={18} />}
                  title="Indexed passages"
                  value={String(report?.chunks || "—")}
                  detail="120 words · 24-word overlap"
                />
                <Metric
                  icon={<CheckCheck size={18} />}
                  title="Hybrid Recall@5"
                  value={percent(baseline?.recall_at_5)}
                  detail="Any annotated evidence hit"
                />
                <Metric
                  icon={<Clock size={18} />}
                  title="Hybrid p95 latency"
                  value={
                    baseline ? `${baseline.latency_ms.p95.toFixed(0)} ms` : "—"
                  }
                  detail="Warm CPU · uncached · sequential"
                />
              </div>
              <section className="chart-card">
                <div className="section-heading">
                  <div>
                    <h2>The accuracy–latency tradeoff</h2>
                    <p>Higher scores help; slower responses have a cost.</p>
                  </div>
                  <select
                    aria-label="Chart metric"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as typeof metric)}
                  >
                    <option value="recall_at_5">Recall@5</option>
                    <option value="mrr">Mean reciprocal rank</option>
                    <option value="answer_token_f1">Answer token F1</option>
                  </select>
                </div>
                <div
                  className="bar-chart"
                  role="img"
                  aria-label={`Comparison of ${label(metric)} across retrieval strategies`}
                >
                  {report?.runs.map((r, i) => (
                    <div className="bar-row" key={r.name}>
                      <span>{label(r.name)}</span>
                      <div>
                        <div
                          style={{ width: `${r[metric] * 100}%` }}
                          className={`bar-fill bar-${i}`}
                        />
                        <b>{percent(r[metric])}</b>
                      </div>
                      <small>
                        {r.latency_ms.p95.toFixed(0)} ms <em>p95</em>
                      </small>
                    </div>
                  ))}
                </div>
                <div className="chart-legend">
                  <span>
                    <i />
                    Evidence retrieval quality
                  </span>
                  <span>
                    Scores from {report?.runs[0]?.positive_n || "—"} positive
                    cases · no response cache
                  </span>
                </div>
              </section>
              <section className="table-card">
                <div className="section-heading">
                  <h2>Every result, in context</h2>
                  <span>{report?.corpus_version?.slice(0, 10)}</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Configuration</th>
                        <th>Recall@5</th>
                        <th>MRR</th>
                        <th>nDCG@5</th>
                        <th>Token F1</th>
                        <th>Citation precision</th>
                        <th>Abstention</th>
                        <th>p95</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report?.runs.map((r) => (
                        <tr key={r.name}>
                          <td>
                            <strong>{label(r.name)}</strong>
                            {r.name === "hybrid" && (
                              <span className="small-tag">DEFAULT</span>
                            )}
                          </td>
                          <td>{percent(r.recall_at_5)}</td>
                          <td>{r.mrr.toFixed(3)}</td>
                          <td>{r.ndcg_at_5.toFixed(3)}</td>
                          <td>{r.answer_token_f1.toFixed(3)}</td>
                          <td>
                            {percent(r.citation_precision)}
                            <small>n={r.citation_precision_n}</small>
                          </td>
                          <td>{percent(r.abstention_accuracy)}</td>
                          <td>{r.latency_ms.p95.toFixed(0)} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              {mode === "live" && (
                <section className="telemetry">
                  <div className="section-heading">
                    <h3>Live session telemetry</h3>
                    <button onClick={() => void refreshMetrics()}>
                      Refresh <Activity size={14} />
                    </button>
                  </div>
                  <div>
                    <span>
                      <strong>{telemetry?.counters.requests || 0}</strong>
                      Requests
                    </span>
                    <span>
                      <strong>{telemetry?.counters.cache_hits || 0}</strong>
                      Cache hits
                    </span>
                    <span>
                      <strong>{telemetry?.counters.abstained || 0}</strong>
                      Refusals
                    </span>
                    <span>
                      <strong>
                        {telemetry?.latency_ms.p95?.toFixed(0) || "—"} ms
                      </strong>
                      Session p95
                    </span>
                  </div>
                  <p>
                    Current API process · last {telemetry?.window || 0} requests
                    · separate from the offline benchmark
                  </p>
                </section>
              )}
              <div className="evaluation-footnotes">
                <div>
                  <ShieldCheck size={20} />
                  <h3>Honest measurement</h3>
                  {report?.limitations?.map((item, i) => (
                    <p key={i}>{item}</p>
                  ))}
                </div>
                <div>
                  <Activity size={20} />
                  <h3>Run provenance</h3>
                  <p>{report?.scope}</p>
                  <p>Embedding: {report?.embedding_model}</p>
                  <p>
                    Run:{" "}
                    {report?.created_at
                      ? new Date(report.created_at).toLocaleString()
                      : "Not run"}
                  </p>
                  <p>
                    Warm cache p95:{" "}
                    {report?.cached_latency_ms?.p95.toFixed(1) || "—"} ms (20
                    repeated requests)
                  </p>
                  <button
                    className="text-button"
                    onClick={() => navigate("failures")}
                  >
                    Investigate the failures <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
          {page === "failures" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">FAILURES ARE DATA, TOO</div>
                  <h1>Find the first broken link.</h1>
                  <p>
                    Inspect benchmark errors by retrieval configuration and
                    failure class.
                  </p>
                </div>
                <span className="large-tag">
                  <ShieldCheck size={15} />
                  Measured cases
                </span>
              </div>
              <div className="failure-grid">
                {classes.map((c) => (
                  <button
                    className={failureClass === c ? "selected" : ""}
                    key={c}
                    onClick={() =>
                      setFailureClass(failureClass === c ? "all" : c)
                    }
                  >
                    <AlertTriangle size={18} />
                    <strong>
                      {failures.filter((f) => f.class === c).length}
                    </strong>
                    <span>{label(c)}</span>
                  </button>
                ))}
              </div>
              <div className="toolbar">
                <div className="filter-input">
                  <Search size={16} />
                  <input
                    aria-label="Filter failure questions"
                    placeholder="Search failure cases…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Failure category"
                  value={failureClass}
                  onChange={(e) => setFailureClass(e.target.value)}
                >
                  <option value="all">All failure classes</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </select>
              </div>
              <section className="table-card">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Question / source</th>
                        <th>Configuration</th>
                        <th>Failure</th>
                        <th>Token F1</th>
                        <th>Inspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFailures.slice(0, 100).map((f, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{f.question}</strong>
                            <small>{f.document_id}</small>
                          </td>
                          <td>{label(f.strategy)}</td>
                          <td>
                            <span className="failure-tag">
                              {label(f.class)}
                            </span>
                          </td>
                          <td>{f.token_f1.toFixed(3)}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Inspect ${f.document_id}`}
                              onClick={() => void openSource(f.document_id)}
                            >
                              <ArrowUpRight size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="muted-note">
                Showing {Math.min(100, filteredFailures.length)} of{" "}
                {filteredFailures.length} matching cases. Full case-level
                results live in the repository. Failure classes are heuristics,
                not human judgments.
              </p>
            </>
          )}
          {page === "guide" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">UNDER THE LENS</div>
                  <h1>From question to evidence.</h1>
                  <p>
                    A transparent retrieval pipeline, with explicit boundaries
                    at every step.
                  </p>
                </div>
                <Sparkles size={30} />
              </div>
              <div className="pipeline">
                {[
                  [
                    "01",
                    "Route",
                    "Detect known adversarial patterns, ambiguous requests, and unsupported version questions.",
                  ],
                  [
                    "02",
                    "Retrieve",
                    "BM25 matches exact terms. MiniLM embeddings find semantic neighbors. RRF combines their ranks.",
                  ],
                  [
                    "03",
                    "Rerank",
                    "An optional cross-encoder rescoring the top 20 passages trades more compute for relevance.",
                  ],
                  [
                    "04",
                    "Verify",
                    "An extractive adapter or local Ollama model proposes exact quotes. Every claim must match a retrieved passage.",
                  ],
                ].map(([n, t, d]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
              <div className="guide-grid">
                <section>
                  <ShieldCheck size={22} />
                  <h2>What “grounded” means here</h2>
                  <p>
                    Every displayed claim is a verbatim quote from a retrieved
                    chunk. Its citation points to the document and exact text
                    offsets.
                  </p>
                  <p>
                    That proves provenance and textual support. It does not
                    prove that the quote fully answers the question. The
                    labelled evaluation tests retrieval and answer overlap
                    separately.
                  </p>
                  <h3>When PolicyLens holds back</h3>
                  <p>
                    Missing document context, unsupported historical versions,
                    recognized injection patterns, low semantic similarity, and
                    failed quote verification lead to clarification or refusal.
                  </p>
                  <p>
                    Pattern detection is defense in depth, not a complete
                    prompt-injection solution. Legal conclusions and
                    multi-document synthesis are outside this version’s scope.
                  </p>
                </section>
                <section>
                  <Command size={22} />
                  <h2>Explain it in 30 seconds</h2>
                  <p>
                    “PolicyLens searches public contract documents using keyword
                    and semantic retrieval. I compare BM25, dense retrieval,
                    hybrid fusion, and reranking on expert-derived CUAD
                    questions. Responses contain only verified quotes, and the
                    dashboard exposes the system’s errors and latency
                    tradeoffs.”
                  </p>
                  <h3>Make the work yours</h3>
                  <p>
                    Read the architecture and walkthrough in the repository.
                    Re-run the evaluation, investigate one failure, change one
                    component, and measure the outcome before describing an
                    improvement.
                  </p>
                  <a
                    className="text-button"
                    href="https://github.com/Osie2x/PolicyLens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open project documentation <ExternalLink size={14} />
                  </a>
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Built to be checked.
            </span>
            <span>Public contract research · CUAD v1 · Not legal advice</span>
            <span>PolicyLens / 01</span>
          </footer>
        </main>
      </div>
      {source && (
        <div className="modal-backdrop" onClick={() => setSource(null)}>
          <section
            className="modal source-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Original source document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">ORIGINAL SOURCE</span>
                <h2>{shortTitle(source.title)}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close source"
                onClick={() => setSource(null)}
              >
                <X size={21} />
              </button>
            </div>
            <div className="source-toolbar">
              <span>{source.version} · Exact text export</span>
              <a
                href={
                  /^https?:\/\//.test(source.source_url)
                    ? source.source_url
                    : undefined
                }
                target="_blank"
                rel="noreferrer"
              >
                Dataset source <ExternalLink size={13} />
              </a>
            </div>
            <pre>
              {current?.chunk.document_id === source.id && source.text ? (
                <>
                  {source.text.slice(0, current.chunk.start)}
                  <mark>
                    {source.text.slice(current.chunk.start, current.chunk.end)}
                  </mark>
                  {source.text.slice(current.chunk.end)}
                </>
              ) : (
                source.text
              )}
            </pre>
            <small>SHA-256: {source.sha256}</small>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Connection settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Connection settings</h2>
              <button
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              The app connects to its same-origin API. Keys stay in memory and
              are never included in the repository.
            </p>
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Optional in local demo mode"
              />
            </label>
            <label>
              Admin key
              <input
                type="password"
                autoComplete="off"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Required for ingestion"
              />
            </label>
            <button className="primary-button" onClick={() => void reconnect()}>
              Test connection <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
      {uploadOpen && (
        <div className="modal-backdrop" onClick={() => setUploadOpen(false)}>
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add source document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Add a source</h2>
              <button
                className="icon-button"
                aria-label="Close upload"
                onClick={() => setUploadOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            {mode !== "live" || !adminKey ? (
              <>
                <p>
                  Ingestion requires a live API, a running worker, and an admin
                  key. The public preview is read-only.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setUploadOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  Configure connection <Settings size={15} />
                </button>
              </>
            ) : (
              <form onSubmit={(e) => void upload(e)}>
                <label>
                  Document title
                  <input
                    name="title"
                    maxLength={200}
                    placeholder="e.g. Acceptable Use Policy"
                  />
                </label>
                <label>
                  Document text
                  <textarea
                    name="text"
                    rows={5}
                    minLength={100}
                    maxLength={200000}
                    placeholder="Paste at least 100 characters, or upload a PDF below."
                  />
                </label>
                <label>
                  Or select a PDF (max 2 MB)
                  <input name="file" type="file" accept="application/pdf" />
                </label>
                <button className="primary-button" type="submit">
                  <Upload size={15} />
                  Queue ingestion
                </button>
              </form>
            )}
            {jobId && (
              <div className="job-status">
                <strong>{jobStatus}</strong>
                <small>Job: {jobId}</small>
                <button className="text-button" onClick={() => void checkJob()}>
                  Refresh status <Activity size={14} />
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card">
      <div>
        {icon}
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
