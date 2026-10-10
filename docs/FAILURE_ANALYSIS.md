# Failure analysis of the measured development slice

Hybrid retrieval's most frequent classified failure was **retrieval miss**, with **52 cases**. Reranking reduced retrieval misses from **52 to 47** and improved MRR from **0.476 to 0.552**, at substantial CPU latency cost.

The failure taxonomy assigns one first-failure class per case, in this order:
retrieval miss, incorrect refusal behavior, citation mismatch, low answer overlap.
A retrieval miss can therefore mask a downstream refusal error. Counts are diagnostic
heuristics and should not be treated as independent human labels.

Citation precision only reached **43.3%** for hybrid and
**43.6%** with reranking. Exact quotation prevents invented
wording, but does not prevent irrelevant or incomplete evidence selection. Low token
F1 and false-positive answers on absent-clause targets remain unresolved.

The governing-law browser check exposed headings separated from their following
sentences. The generator now preserves adjacent short headings, favors exact clause
phrases, and drops much weaker candidates. This was development on a visible case;
it is not evidence of an improvement on untouched held-out data.

Caching reduced latency for repeated questions, but does not improve evidence
quality or reduce the cost of new queries. The next intervention should be evaluated
on independently selected contracts with new question rewrites, a richer abstention
set, and manual relevance/correctness checks.

See `reports/failures.json` and the per-configuration case files for exact questions,
document IDs, status, lexical overlap, and retrieval outcomes. The benchmark is scoped
to selected contracts; document-selection failures, real historical-version conflicts,
parser failures, and load-induced timeouts require separate datasets and tests.
