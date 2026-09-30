---
title: "Voracle: Vulnerability Assessment for IEC 61850 Device Documents"
summary: An end-to-end prototype that reads a substation device manual, works out what the device actually is, and returns a ranked shortlist of CVEs that plausibly apply to it.
date: 2026-04-30
status: completed
tags: industrial-cybersecurity, iec-61850, cve-retrieval, llm, semantic-search, faiss, iop
report: https://drive.google.com/file/d/1A2cs0U0OM0D7b42QiGunCcLdjFL4VDBC/view?usp=sharing
---

## What this project is about

A modern substation runs on digital equipment. Protection relays, gateways, communication
modules, merging units, each with its own firmware and its own stack of supported protocols.
That equipment is what makes remote control and fast protection possible, and it is also what
gives a substation an attack surface it did not have thirty years ago.

The awkward part is that nobody has a clean inventory of it. What exists is documentation.
Vendor manuals, hundreds of pages long, written for a commissioning engineer rather than for a
security analyst, with the model number on one page, the Ethernet options on another and the
supported IEC 61850 services somewhere in an appendix. If you want to know whether a
particular relay is exposed to a known vulnerability, someone has to read all of that, work
out what the device really contains, and then go hunting through CVE databases for anything
that matches. It is slow, and it does not scale to a whole station, let alone a fleet.

This was our Industry-Oriented Project at IIT Roorkee. We were given a reference paper on
similarity-driven vulnerability assessment for IEC 61850 devices, and the brief was to take it
from a method described on paper to something that actually runs. We built that system and
called it Voracle. You hand it a device PDF, and it hands back a ranked vulnerability report.

## What the problem actually is

Stated plainly, the task is this. Given a technical PDF for a substation or electrical device,
produce an assessment that identifies what the device is made of, retrieves the CVE records
most likely to apply to it, orders them so the serious ones come first, and presents the
result in a form an analyst can read and act on.

Two things make this harder than it sounds.

The first is that the input is unstructured and inconsistent. A PDF is a layout format, not a
data format. Two manuals for comparable devices will describe the same fact in different
places and in different words, and some of them are scans with columns that do not extract
cleanly. Whatever pulls features out of the document has to cope with that variability instead
of assuming a schema.

The second is that the matching step has no exact key to join on. Nothing in a vendor manual
says "this is CVE-2021-XXXX". The link between a device and a vulnerability lives in the
language: a CVE description mentions a product family, a protocol stack, a firmware component,
and you have to judge whether the device in front of you is the thing being described. That
judgment is a similarity problem, which is what the reference paper proposed, and it is also
why the honest output is a prioritized shortlist for a human rather than a verdict.

## What we built

Voracle is four layers stacked on each other, and it is worth separating them because each one
fails in a different way.

**The document layer** opens the PDF and gets text out of it, page by page, using
`pdfplumber`. Nothing clever happens here, but everything downstream inherits the quality of
this step.

**The extraction layer** turns that text into structured device features. The text is split
into chunks that fit a token budget, and each chunk goes to an instruction-tuned language
model with a prompt asking for strict JSON: vendor, model, components, protocols,
capabilities. Every chunk response is validated and cleaned before it is trusted, because a
model asked for JSON will occasionally return JSON wrapped in an apology. The per-chunk
results are then merged into one consolidated feature record for the device. We ran this with
Qwen2.5-3B-Instruct quantized to 4 bits, which was the point on the quality versus compute
curve that fit the hardware available to us during the project. The interface does not care
which model sits behind it. Anything in the Llama-Instruct, Mistral-Instruct, Phi or Gemma
families that returns clean JSON drops into the same slot, so our results are specific to
Qwen but the pipeline is not.

**The retrieval layer** holds the CVE side. CVE records are parsed into a working corpus,
embedded with a sentence-transformer model and indexed with FAISS. At query time the
consolidated device features are assembled into a single query string, embedded the same way,
and used to pull the top k nearest CVE records.

**The application layer** is what makes it usable. A FastAPI service orchestrates the run and
streams progress events while it works, and a React frontend on the other end shows the
document moving through each stage, the severity and risk summary, the top vulnerabilities and
a report you can download.

## The pipeline, step by step

The whole procedure fits on one page as an algorithm, and reading it in order is the clearest
way to see what depends on what.

![Algorithm 1, the end-to-end vulnerability assessment workflow, in 15 numbered lines: text extraction and token chunking, a per-chunk loop that produces and cleans JSON device features, a merge into one feature record, retriever construction and top-k CVE retrieval, a scoring loop multiplying similarity by CVSS, and a final ranked report.](../../images/voracle/algorithm_voracle.svg){narrow}
Algorithm 1 as it appears in our report. It takes a device PDF P, a CVE source C and a
retrieval size k, and returns a ranked assessment report R. Everything upstream of line 8
concerns the device, everything from line 8 onward concerns the vulnerability corpus, and the
two only meet at line 10.

The listing breaks into four movements.

- **Lines 1 and 2, preparation.** The PDF is flattened to text and the text is split by token
count rather than by page or by paragraph. That choice is deliberate. A page boundary is a
typesetting accident and tells you nothing about where one topic ends, whereas a token budget
is what actually has to be respected, since every chunk has to fit inside the context window
of the model that will read it. This is also the stage that decides how good everything after
it can be, because whatever `pdfplumber` fails to recover from an awkward layout is simply
gone by line 3.
- **Lines 3 to 7, extraction and merge.** The loop runs once per chunk. Line 4 sends the chunk
to the language model and asks for strict JSON describing any device features it mentions, and
line 5 validates and cleans that output before it is allowed into the collection, which is the
guard against a model that decides to wrap its JSON in a sentence of explanation. Running per
chunk is what makes the approach work on a real manual: no single passage has to contain the
whole device description, because line 7 merges the fragments afterwards. In practice most
chunks contribute nothing at all, a couple of them carry the vendor and the model number,
others carry protocols or component names, and the merge is what reassembles a description
that the document had scattered over two hundred pages.
- **Lines 8 to 10, retrieval.** Line 8 either builds the CVE retriever from scratch or loads a
cached one, which is the expensive step and the reason the cache exists. Line 9 collapses the
merged feature record into a single query string, and line 10 returns the k nearest CVE
records to it. This is the similarity idea from the reference paper, and it is the only line
in the whole algorithm where the device and the vulnerability corpus are brought into contact.
Note the ordering: the retriever knows nothing about this particular device, so the index can
be built once and reused across every document you subsequently assess.
- **Lines 11 to 15, scoring and report.** Each retrieved candidate is scored on line 12 by
multiplying its similarity to the query by its CVSS score, then line 14 ranks the candidates
and summarizes them into the report. Ranking has to happen after retrieval rather than inside
it because severity is a property of the CVE alone and says nothing about relevance, so it
cannot be used to decide what comes back, only to order what did.

Two properties are worth pulling out. Extraction and retrieval are decoupled, connected only
by the query string on line 9, so a better extraction model or a better embedding model
improves the output without either one needing to know about the other. And nothing in the
loop claims certainty. Every stage produces evidence, and the ranking is a way of ordering
that evidence for someone who will read it, not a proof that any of it applies.

## Scoring

For each retrieved candidate j we compute a risk score as the semantic similarity between the
device query and the CVE text, multiplied by the CVSS score of that CVE:

```
R_j = s_j x CVSS_j
```

Candidates are ranked by R and reported with the CVE ID, the severity band, the CVSS score and
enough descriptive context for the analyst to decide whether it genuinely applies.

The product is deliberate. Similarity by itself floats textually close but harmless entries to
the top. CVSS by itself floats the scariest CVEs in the database regardless of whether they
have anything to do with this device. Multiplying the two asks for both at once: this looks
like your device, and it would matter if it were.

## Two ways to run it

The backend supports two execution modes, which exist for different situations.

**In-memory mode** parses the CVE JSON files, builds the record list in memory, generates
embeddings, builds the FAISS index and retrieves directly, with no database anywhere in the
path. It is what you want for a demonstration or a quick experiment, because there is nothing
to set up first.

**PostgreSQL-assisted mode** creates or updates a `cve_records` table, batch upserts records
into it, and then combines optional structured filtering with the same semantic retrieval.
This is the mode for larger CVE collections and for workflows you intend to repeat, since the
corpus survives between runs and the candidate set can be narrowed by structured fields before
the semantic search ever runs.

The backend is Python throughout, built on `pdfplumber`, `transformers`, `bitsandbytes`,
`sentence-transformers`, `faiss-cpu`, `FastAPI` and `psycopg2`. The frontend is React with
TypeScript on Vite, handling upload, the live log stream from the backend, the severity and
risk summary, the top vulnerability list and the PDF export.

## How we evaluated it

We were building an engineering prototype rather than entering a benchmark, so the evaluation
aimed at whether the system behaves sensibly end to end. We looked at four things: how
completely it extracted features from representative electrical device PDFs, how relevant the
top-ranked CVE matches were, whether the severity and risk summaries were interpretable, and
whether the whole path from upload to downloaded report worked in practice.

It held up. The pipeline produced structured feature records consistently and returned
vulnerability shortlists that were useful as a starting point for review. In-memory mode was
the better fit for demonstrations, and the PostgreSQL path handled the larger CVE collections
more comfortably, which is the split we designed it for.

We want to be clear about what we did not do. There is no labeled ground-truth dataset mapping
these specific devices to the CVEs that truly apply to them, so we have no precision and
recall numbers to report. Building that dataset is real work, and it sat outside the scope of
this project.

## What we ran into

Five things gave us trouble, and all five are properties of the problem rather than bugs we
could go and fix.

Document variability decides extraction quality more than anything else we control. A clean
digital manual extracts well, a scanned or heavily columned one does not, and the rest of the
pipeline can only work with what it is handed.

Language model output reliability has to be defended against. Asking for strict JSON gets you
JSON most of the time, and the validation and cleanup stage exists entirely to handle the
rest.

Similarity is ambiguous by nature. Semantic retrieval will surface CVEs that are genuinely
about a related product or a related protocol but do not apply to the device in hand, and no
similarity threshold removes those without also removing real matches. An analyst still reads
the list.

Operational cost is not zero. Loading a quantized model and generating embeddings over a CVE
corpus takes time, and on a cold start that time is visible to the user.

And the distance between a working prototype and a production system is mostly unglamorous:
consolidation, tests, deployment controls, error handling for the cases we never hit during
development.

## Limitations

The output depends on the quality of the features extracted from the source document, so a
poor document gives a poor assessment. The risk ranking is a prioritization heuristic and not
exploit validation, which means a high score says "look at this first", not "this device is
exploitable". Quantitative metrics wait on a labeled ground-truth dataset. And several rounds
of hardening stand between this and anything that should run against real infrastructure.

What the project does show is that the idea in the paper survives contact with real documents.
A similarity-driven mapping from device documentation to vulnerability evidence can be built,
can be run end to end by someone who did not write it, and produces output an analyst can work
with. That was the thing we set out to find out.

## Team

This was an Industry-Oriented Project in the Department of Electrical Engineering, IIT
Roorkee, carried out with my teammate Swastic Keshari under the mentorship of
Prof. Parikshit Pareek, from January 2026 to April 2026.
