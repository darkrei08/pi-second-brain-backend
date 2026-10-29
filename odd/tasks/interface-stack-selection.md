# Feature: interaction surface selection against the open-source UI market

Reopens Wayfinder `.scratch/interface-stack/` ticket 01 with a wider candidate set and a stricter UX target. Decision-only slice: no client is installed, vendored, or configured.

## Specs

- S1. Candidate search covers the open-source market, not only the four shells already compared. Quote: "Trova la soluzione migliore rispetto a tutte le interfacce grafiche, rispetto a quello che il mercato open source offre".
- S2. The primary surface must match a ChatGPT/Perplexity-grade chat UI with grouping and sub-chats. Quote: "abbia quasi la stessa interfaccia grafica di chat GPT di Perplexity, che addirittura ha le sottocategorie di gruppi e di sottochat e documenti appartenenti a quel gruppo o a quelle chat".
- S3. Management surface must be the most complete a single owner can use. Quote: "abbia l'interfaccia gestionale più completa possibile che all'utente possa servire".
- S4. NotebookLM-grade automatic source targeting and reorganization plus a deep-research section, without prompt engineering by the user. Quote: "abbia ad esempio l'auto-targeting e riorganizzazione di documenti come quella di notebook LM di Google in cui c'è anche la sezione di ricerca approfondita e non iniettando un prompt e quant'altro".
- S5. Visual evidence of the evaluated software. Quote: "Puoi fare anche delle schermate screenshot di queste di questi software".
- S6. Every surviving candidate is judged on what it requires from our gateway, verified from upstream source or documentation, not from feature pages. Inherited from `.scratch/interface-stack/research-integration.md`.
- S7. The ticket's existing constraints hold: MIT/Apache licence position stated per candidate, V1-V5 answered, `docs/implementation-brief.md` gateway contract updated, nothing installed or vendored, no corpus or credential in the repository, single owner, loopback-only.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S3, S4 | Workflow: three read-only market-researcher agents, one candidate cluster each | `c2ed36f` |
| T2 | S5 | Parent: five authentic UI captures; agent-supplied URLs resolved to marketing assets and were rejected | `c2ed36f` |
| T3 | S6, S7 | Parent: GitHub API metadata, upstream licence text, live demos, repository assets | `c2ed36f` |
| T4 | S6 | Parent: `research-ui-landscape.md`, map update | `c2ed36f` |
| T5 | S7 | Parent + writer: ticket 01 resolved (V1-V7) | `2a5fee7` |
| T6 | S7 | Parent + writer: `docs/implementation-brief.md` gateway contract, ticket 02 unblocked | this commit |
| T7 | S7 | Parent: work-unit commits, Engram checkpoint | this commit |

## Log

- L1 (operator request, 2026-10-29): "Trova la soluzione migliore rispetto a tutte le interfacce grafiche, rispetto a quello che il mercato open source offre, in modo tale che abbia quasi la stessa interfaccia grafica di chat GPT di Perplexity, che addirittura ha le sottocategorie di gruppi e di sottochat e documenti appartenenti a quel gruppo o a quelle chat, e che quindi abbia l'interfaccia gestionale più completa possibile che all'utente possa servire, che soprattutto abbia ad esempio l'auto-targeting e riorganizzazione di documenti come quella di notebook LM di Google in cui c'è anche la sezione di ricerca approfondita e non iniettando un prompt e quant'altro. Puoi fare anche delle schermate screenshot di queste di questi software e se mi permetti anche di abilitare il remote forward e local forward poi possiamo anche cercare di permettermi di darti delle indicazioni utilizzando il mio browser io uso floorp, uso Firefox, uso Brave, uso Google Chrome, dimmi tu, prevalentemente uso Floorp con BitWord nelle mie credenziali, in modo tale che tu possa in automatico fare la scansione, altrimenti dimmi tu quale browser migliore sia utile per te e per analizzare le schermate i contesti fare ulteriori ricerche eccetera".
- L2 (recovery constraint, 2026-10-29): context reset plus autonomous continuation; state must be reconciled from Git, tracker, and tests, never from prior summaries.
- L3 (browser capability, verified by the parent): BrowserOS neo drives a real Chromium with inline screenshots; host port 9222 is Lightpanda and cannot render. No forward from the operator's browser is needed for public sites.
- L4 (evidence rule, adopted by the parent after the researcher passes): six researcher claims failed verification (RAGFlow and Onyx version numbers, a Perplexica rename, every screenshot URL, SurfSense stars) and were excluded. Only GitHub API metadata, upstream licence text, live instances and repository assets count as evidence.
- L5 (decision, 2026-10-29): V1 Open WebUI, V2 split ownership with one source of truth per record type, V3 folder as a retrieval scope, V4 ingest into our store, V5 one identity mapping row, V6 our own API plus shell glue, V7 accepted second store with separate boundaries. Recorded in `map.md` and ticket 01; propagated into `docs/implementation-brief.md` and ticket 02.
- L6 (delivery note): the branch carries 47 commits and about 6.3k authored lines across the Wayfinder series; the repository policy is already stacked PRs, one per Wayfinder, merged in order. No push or PR was performed by this slice.
