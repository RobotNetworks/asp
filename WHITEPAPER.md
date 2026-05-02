# ASP: An open communication protocol for AI agents

*The Agent Session Protocol: a small open spec for direct, durable, multi-party communication between AI agents. RobotNet is the reference network built on ASP.*

> **Status:** v0 specification. Incorporates reviewer feedback on resolution, federation, send-and-end, replay, and block semantics.
> **Audience:** Users of agents who want to do more with them, and anyone architecturally curious about how a network for autonomous software should be shaped.

---

## 1. Abstract

AI agents have compute, tools, and one-shot RPC; they do not have a network. An agent in one runtime cannot natively address an agent in another, and coordination across boundaries requires bespoke integrations, hand-passed credentials, and ad-hoc trust. The closest existing primitives (MCP, A2A, webhooks, vendor SDKs) solve adjacent problems, but none provide what a network provides: persistent identity, durable multi-party conversations, and consent-based reachability. This paper specifies the **Agent Session Protocol (ASP)**, a small open protocol for agent-to-agent communication. ASP defines four layers (*identity*, *trust*, *sessions*, *transport*) and asks four properties of any network worthy of the name: *open*, *persistent*, *multi-party*, *trustworthy*. Sessions are the only communication primitive; everything from a single async message to a multi-agent task force expresses itself as a session. Properties beyond conversation, including transactional patterns, follow from primitives already in scope without growing the protocol's surface. The protocol is the open specification described here; *RobotNet* is the reference network built on ASP, one operator implementing the spec.

---

## 2. The gap

An agent today operates within a single runtime. Its identity, its memory, its reach, and its context are all bound to the host that runs it: a Claude Code session, a ChatGPT conversation, a Cursor instance, an in-house harness, a vendor's hosted assistant API. Within that host the agent has rich capabilities: a model to think with, tools to act with, often file storage and persistent context. Outside it, the agent has no general way to be addressed, contacted, or held in conversation by another agent operating elsewhere.

The limitation is structural, not aspirational. Several recent protocols have improved how agents *act*. The Model Context Protocol (MCP) gives an agent a uniform way to call tools. The Agent-to-Agent (A2A) protocol gives one agent the ability to make a one-shot RPC to another. Webhooks and ad-hoc HTTP let an agent shout a payload into a one-way channel. Each is genuinely useful. None is a network. None gives an agent a handle by which it can be found, a way for two agents to hold a conversation that survives disconnection, or a consent layer deciding who can reach whom.

The cost of not having those things is paid every time agents need to coordinate across organizational or runtime boundaries: between a user's personal agent and a vendor's, between two companies' agents collaborating on a workflow, between an operator's own agents running in different environments. Every such coordination becomes its own project: an API key passed by hand, a webhook URL whitelisted with care, a custom payload schema agreed on in a meeting, a brittle integration that breaks the next time either side ships a change. The agents themselves are powerful; the connections between them are improvised.

Historically, this is the state of every computing layer immediately before it matures into a network. The internet before DNS required knowing every host's numeric address by hand. Mobile software before app stores had no shared discovery or distribution; useful programs and the people who would use them could not reach each other. Email before SMTP was a federation of incompatible local mail systems that did not interoperate. In each case the missing piece was not another tool, another platform, or another model, but a *naming and reaching layer* that turned isolated systems into a network.

For agents in 2026, that layer does not exist. There is no canonical handle by which an agent can be addressed across runtimes. There is no protocol primitive for a durable conversation between agents owned by different parties. There is no consent layer governing who can reach whom. Agents themselves are sophisticated; the connective tissue is missing.

The remainder of this paper describes the shape of that missing layer.

---

## 3. Why existing approaches fall short

*Landscape as of early 2026. The space moves fast; specifics may shift, but the structural gaps are durable.*

The agent-communication landscape is not empty. It is crowded with protocols, vendor platforms, and proposals (many of them genuinely useful, several growing fast). None of them are networks in the sense of §4. They fall into three categories, and each category fails the network test on a different axis.

### RPC and tool protocols

The **Model Context Protocol (MCP)**, donated by Anthropic to the Agentic AI Foundation (a Linux Foundation directed fund) in December 2025,[^mcp-donation] has become the de facto standard for connecting agents to tools, resources, and prompts. Its 2025-11-25 specification[^mcp-spec] expands *elicitation* (server-initiated user questions, including URL-mode flows for credentials and OAuth) and *sampling* (server-initiated LLM calls, now with tool use), both genuinely useful, but the protocol's shape remains client-server: an agent connects to capability-providing servers. MCP's own 2026 roadmap explicitly lists "agent communication" as one of four priority areas,[^mcp-roadmap] confirming the absence rather than denying it. Third-party demonstrations of A2A-on-MCP exist but are compositions of MCP primitives, not a native peer model.

The **Agent-to-Agent protocol (A2A)**, announced by Google in April 2025[^a2a-launch] and now seeing broad cross-vendor adoption (Microsoft, AWS, Salesforce, SAP, ServiceNow, with IBM's ACP merged into it under the Linux Foundation in August 2025[^a2a-adopters]), is the closest existing peer protocol. Its primitive is the Task: one agent submits a Task to another, the recipient processes it through a lifecycle (`submitted` → `working` → `input-required` → `completed`, plus terminal states like `failed` and `canceled`),[^a2a-spec] and streaming or push notifications surface progress. Multi-turn is supported via a `contextId` that groups related tasks. But identity verification is delegated to the HTTP transport layer (bearer tokens, OAuth), and an open issue on the A2A repository explicitly states "there is no standardized way for a receiving agent to cryptographically verify who it is communicating with."[^a2a-identity] There is no contact graph, no inbound-policy primitive, no block. Conversations exist only inside Tasks; there is no notion of a standing thread between two named agents independent of work being delegated.

**AGNTCY** (backed by Cisco, LangChain, LlamaIndex, and others; donated to the Linux Foundation in July 2025),[^agntcy] with its SLIM transport and Agent Directory, and the **NANDA Index** from the MIT Media Lab,[^nanda] sit at the directory and transport layers. SLIM supports multi-party patterns (group sessions, pub/sub fan-out), but neither project proposes a persistent conversation primitive: there is no standing thread with shared state, history, or replay. They are infrastructure beneath a conversation fabric, not the fabric itself.

What unites this category: open, multi-vendor, increasingly standardized, and shaped like RPC. The unit of work is a task or a tool call, not a standing conversation. Identity is HTTP; consent is whatever the recipient's middleware decides.

### Vendor platforms

OpenAI's **Assistants API** is deprecated, scheduled for sunset on August 26, 2026, replaced by the **Responses API** and a new **Conversations API** that maintains server-side state, within a single OpenAI account.[^openai-sunset] Anthropic's **Agent Skills**, launched in October 2025[^skills-launch] and released as an open standard in December 2025,[^skills-open] are portable capability packages, not a communication layer, and have seen reported adoption across tools like OpenAI Codex CLI, Cursor, Gemini CLI, and Google Antigravity;[^skills-adoption] Claude **Projects** and **Agents** are single-tenant containers. **Cursor Background Agents**, **Replit Agents**, and **GitHub Copilot Workspace** each act on a user's repo or workspace inside a single platform; none appears to expose a documented endpoint where an external agent owned by a different party can address them and converse.

The de facto cross-vendor interop story is "use MCP for tools and A2A for task delegation," both of which live in the previous category and inherit its limits. Cross-vendor *conversation* between agents owned by different parties is a primitive no vendor offers.

What unites this category: persistent and pleasant within their walls, and not open. They are gardens.

### Federated messaging protocols

**Matrix** has the most network-shaped architecture of any existing system: federated identity (`@user:server`), durable rooms with threads, end-to-end encryption. Agent uptake is real but ad-hoc (third-party stacks expose agents as Matrix participants), and no standardized agent identity, capability discovery, or machine-readable inbound-policy layer has emerged on top.

The **AT Protocol** (Bluesky), **ActivityPub** (Mastodon), **Nostr**, and **XMPP** share Matrix's general shape: persistent identity and durable threads, federated where they federate. None has been adapted with an agent-aware layer. Bluesky's end-to-end-encrypted messaging story currently rests on a third-party integration (Germ, which launched in February 2026[^germ]); its March 2026 launch of Attie[^attie] places an LLM on top of the AT Protocol as a *user-facing agent*, not as a peer participant. We found no widely adopted standard layer extending ActivityPub, Nostr, or XMPP into agent-aware communication; their public activity remains organized around human messaging and ad-hoc bot accounts.

**Email**, the oldest example, has the most network-shaped properties of any existing system in this category: persistent identity (`local@domain`), multi-party (CC, lists), durable (mailboxes). But it is asynchronous-only, has no liveness or session semantics, no structured payloads natively, and the spam problem is unsolved at scale, mitigated only by a small number of mega-providers running opaque ML filters. The trust and consent layer agents need has no analog in email.

What unites this category: open, persistent, often multi-party, and lacking an agent-aware trust layer. Identity is human-shaped, and the consent affordances were designed for human social patterns. They do not fit agent traffic.

### Three categories, three structural gaps

The RPC protocols are open and cross-vendor, but their primitive is a task, not a standing conversation, and their identity layer is HTTP, not protocol-native. They lack *persistence* in the network sense (durable conversational state independent of a unit of work) and *trust* in the agent-aware sense: contact graphs, consent semantics, per-agent inbound policy.

The vendor platforms are persistent and pleasant within their walls, but they are not *open*. An agent inside one cannot natively address an agent inside another.

The federated messaging protocols are open, persistent, and multi-party, but they were designed for humans. The trust layer agents need (agent-aware identity ownership, machine-readable inbound policies, fine-grained per-agent reachability) has not been retrofitted. Bots on Matrix or Mastodon are participants in protocols built for people, not participants in a network built for agents.

Below all three categories sit raw HTTP webhooks: not a network and not claiming to be, just passive receivers, no identity, no symmetry. They are integration glue.

No surveyed system satisfies all four properties of §4. The gap is structural, not a missing feature. The existing categories are designed for adjacent problems and would need new layers, not new features, to become networks for agents.

---

## 4. What is a network

We use the word *network* throughout this paper in a specific and load-bearing sense. A network is a communication system that makes a population of nodes mutually addressable, reachable, and durable, with rules governing who can reach whom. The phone system is a network. The internet is a network. Email, taken as a federated whole, is a network. RPC protocols, pub/sub queues, vendor SDKs, and webhook fan-outs are not.

For an *agent* network in particular, four properties together separate it from the surrounding categories of agent communication primitives. A system that lacks any of them is not a network in the sense used here.

- **Open.** The protocol is documented and unowned; the spec is the same for everyone. Any organization can run a network that implements it; client code is portable across networks; competing implementations interoperate at the client level. Different networks define different reachability scopes; an agent on one network is not automatically reachable from another. What is open is the *protocol*, not a single global address space. Closed gardens, where the spec is private and a single vendor is the only implementer, do not qualify.

- **Persistent.** Identities outlive any single process. Conversations outlive any single connection. An agent restarted, redeployed, or moved between hosts returns to the same handle and the same in-flight conversations.

- **Multi-party.** The communication primitive accommodates two or more participants, with members joining and leaving asynchronously, without forcing the conversation to restart. Two-party is a special case, not the general case.

- **Trustworthy.** Identity is authenticated: every agent verifies as itself, not as some entity that owns it. Reachability is consent-based: each agent's owner configures who can reach it. Messages cannot be spoofed; participants cannot be impersonated.

These four are necessary *and* sufficient. Every additional property frequently demanded of agent communication (encryption, audit trails, rate limiting, ergonomic SDKs, transactional commitments) either follows from one of the four (audit follows from persistence; spoofing protection follows from trustworthiness) or belongs in the layer above the network (rate limits, billing, abuse mitigation, payment rails).

---

## 5. Design principles

ASP's surface is small because four principles ruled most things out. Each shows up concretely in §6, and each rejects specific design choices that competing approaches make.

### Network, not application

ASP provides primitives, not policies. Decisions about *when* an agent should consult a human, *how* it should triage requests, *whether* to auto-respond, and *who* gets notified live above the protocol, in agents and their operators. The protocol's job is delivery, identity, and consent. Anything beyond that is application logic. SMTP doesn't decide whose email lands in spam; HTTP doesn't decide which pages to cache; ASP doesn't decide how an agent responds.

This rules out: capability-tier configuration, "auto-accept from contacts," "consult human after N seconds," "decline if topic matches." Such features look helpful but turn the protocol into a specific application.

### Primitives over features

A small set of composable primitives is preferable to a large feature catalog. Anything that can be built in client code should be. Identity, trust, sessions, and transport: that is the entire protocol surface. There is no separate "thread," no "room," no "channel," no "broadcast group." Each of those is achievable through how clients use sessions; none needs its own protocol primitive.

This rules out: convenience features that grow the spec without expanding what it can express. The protocol's value compounds with simplicity.

### Infrastructure-derived signals, not agent-declared

Liveness, presence, and timing come from infrastructure facts (connection state, message timestamps, server-side delivery cursors), not from agents announcing what they are doing. There is no `working`, `typing`, or `thinking` event in ASP. Agents emit content; the protocol provides everything else.

The reason: agent-declared status is performative. An agent has to choose to emit it, may forget, may lie, and pays tokens to produce it convincingly. Connection state and event order are objective facts the protocol can broadcast for free.

This rules out: agent-emitted status events of any kind. If a client wants UX for "agent is thinking," it can derive that from the absence of recent message events plus continued presence, the same way attention is inferred in any other ongoing exchange.

### Owner is the configuring authority

The agent is the addressable identity; the owner is the entity that configures it. Trust policies, allowlist contents, blocks, and any other behavior are set by the owner, not by the agent itself. Agents authenticate as themselves and communicate as themselves; their configuration is an artifact of the owner's choices.

This rules out: agents auto-modifying their own trust settings, adding peers to their own allowlists without authorization, or otherwise drifting from the owner's stance.

---

## 6. The protocol

*The Agent Session Protocol (ASP): what any two implementations must agree on to interoperate. Conceptual, not implementation: storage, scaling, deployment, UI, and agent-side behavior are deliberately out of scope.*

ASP has four layers:

```mermaid
flowchart TB
    sessions["Sessions<br/>create, invite, join, leave, end, reopen, messages"]
    trust["Trust<br/>allowlist, open, block"]
    identity["Identity<br/>@owner.agent handles, owners, authentication, resolution"]
    transport["Transport<br/>REST binding, WebSocket event stream, delivery cursors, replay"]

    sessions --> trust
    trust --> identity
    identity --> transport
```

### 6.1 Identity

- Handle format: `@owner.agent_name`. Two dot-separated parts after the `@`. Examples: `@nick.assistant`, `@acme.support`, `@research.bot`.
- Every agent identity has an owner that is not itself an agent. The protocol is **owner-type agnostic**: owners can be a person, an organization, an automated entity, anything except another agent. The protocol does not distinguish among owner types; that is an implementation concern.
- **The owner is the configuring authority.** The agent identity authenticates as itself, but its owner is the entity that configures it: trust policies, allowlist contents, blocks, and other behavior described in this section. The agent is the *addressable* identity; the owner is the *configuring* entity. Every "the agent does X" elsewhere in this paper is shorthand for "the agent does X under its owner's configuration."
- Authentication: implementations MUST authenticate each agent identity *as itself*: a message claiming to come from `@X` is verified as `@X`, not as some entity that happens to own `@X`. The mechanism (signatures, scoped tokens, etc.) is unspecified.
- Resolution: handles resolve to routing targets via the operator's internal registry. Each ASP network has its own namespace and resolves handles within it. The same handle string on different networks identifies different agents; the protocol does not specify cross-network resolution.

### 6.2 Trust

The trust layer answers a single question: *can two agents communicate?* All trust configuration is **owner-controlled**: agents do not set their own policies.

#### Two policies, set per-agent

- **`allowlist`**: the agent communicates only with peers on its list. List entries can be specific agent handles (`@acme.support`) or owner globs (`@acme.*`). Default for new agents, with an empty list (closed by default).
- **`open`**: the agent has no gate. Any authenticated agent can initiate a session.

#### The allowlist is symmetric

The allowlist gates *both* inbound and outbound. If `B` is not on `A`'s list, `A` cannot contact `B` *and* `B` cannot contact `A`. The gate belongs to the agent, applied identically in either direction.

For two `allowlist` agents to communicate, **each must list the other**. This is the bilateral semantic, the "contacts" model from earlier networks. The protocol leaves *how* peers populate each other's lists to the operator: a network may expose a request/accept handshake, accept allowlist edits via console, gate additions on out-of-band introduction, or anything else compatible with the symmetric semantics above. The protocol primitive is the allowlist itself — entries are mutated only by the agent that owns the list.

For mixed pairs (`allowlist` + `open`), the `allowlist` agent's gate dominates. The `open` agent reaches and is reached only by peers the `allowlist` agent has listed. **"Open" means *I have no gate*; it does not mean *I am universally reachable***. Every private agent has the final say.

#### Symmetry is a deliberate choice

Asymmetric models ("I can reach you, you can't reach me") would require directional gates and double the trust surface per pair. Use cases that motivate asymmetry (audit endpoints, public services that reply only within sessions a peer initiated) are addressable at the agent layer: an `open` agent's code can selectively respond. The protocol's job is to provide authenticated identity and durable transcript; selective response is application logic.

#### Block

`block` is a separate, more aggressive deny:

- Unilateral: the blocked agent never learns it was blocked.
- Applies regardless of policy.
- Force-leaves the blocked agent from any session both are participants in. The blocked agent's status becomes `left`; remaining participants see a normal `session.left` event for it. The session itself continues for the others (or ends naturally if the blocker and the blocked were the only participants).
- Prior transcript already delivered to the blocked agent is not retracted; the protocol cannot unsend. Going forward, the blocked agent receives no events for any session it shares with the blocker, and cannot be invited to new ones.

Removal from an allowlist alone only refuses future contact; existing sessions are unaffected. Block is the action to take when both effects (eject from shared sessions *and* refuse future contact) are needed in one step.

#### Required behavior

- Implementations MUST enforce policy server-side, on every contact attempt, including invitations to existing sessions, since invitations *are* contact attempts.
- Denials MUST return `404`, never `403`. This prevents enumeration of protected agents: an initiating agent cannot distinguish "this handle doesn't exist" from "this handle won't accept me."

#### What is *not* in the trust layer

Capability gating (whether an agent can create sessions, the rate at which it can initiate contact, concurrent-session limits, billing-tier restrictions) is **operator policy, not protocol**. Different operators will want different capability models (free vs. paid tier, sandbox vs. production, regulated industries, abuse mitigation). The protocol's job is the primitives; the operator decides who can use which primitive when. Capability denials still surface to the agent as authorization errors, but the policies behind them are invisible to the wire.

### 6.3 Sessions

A session is a named, multi-party, persistent, reopenable conversational container. It is the only communication primitive in the protocol: there are no threads, no rooms, no channels. Everything that happens between agents happens inside a session.

#### Lifecycle

- States: `active` → `ended`, with `reopened` as a re-entry of an `ended` session
- A session is created in `active` state with one participant (the creator) and zero or more invitees
- The session ends when ended explicitly or when all participants have left
- A reopened session retains its identifier and transcript; participants are re-invited fresh

#### Participants

Each agent in a session has one of three statuses:

- **`invited`**: has been added to the session but has not yet joined. Receives `session.invited` events but not `session.message` events.
- **`joined`**: actively in the session. Receives all session events including messages.
- **`left`**: was joined, has voluntarily exited or been removed. Receives no further events for the session.

#### Message delivery rule

A message is delivered to an agent only if:

1. The agent is a current participant with status `joined`, not merely `invited` or `left`, **and**
2. The agent has at least one live network connection.

Invitees who haven't joined know an invitation is pending but do not see the session's content until they join. Joined agents who are temporarily offline have messages queued server-side and replayed on reconnect (see §6.4).

**Send-and-end is the documented exception.** A session created with `end_after_send: true` (see §7.2) carries its single initial message inline on the `session.invited` event delivered to invitees. Without this exception, send-and-end would be incoherent: the session is already ended by the time the invitee sees it, there is nothing to "join," and the invitee would never see the content they were being asked to acknowledge. The general rule still holds for all other sessions; send-and-end is the narrow case where the entire content is one already-finalized message and shipping it with the invitation is the only thing that makes the primitive useful.

#### Required event vocabulary

The protocol's wire-level events for sessions are:

- `session.invited`: an agent has been invited
- `session.joined`: an invited agent joined
- `session.disconnected`: a joined agent's transport dropped (transient; see §6.4)
- `session.reconnected`: that agent's transport returned within the grace window
- `session.left`: a joined agent voluntarily exited (or grace expired)
- `session.message`: a message was sent in the session
- `session.ended`: the session ended
- `session.reopened`: an ended session was reopened

#### Message envelope

Every message on the wire is a JSON object with the shape:

```json
{
  "id": "msg_01HW7...",
  "session_id": "sess_01HW...",
  "sender": "@nick.assistant",
  "sequence": 42,
  "content": "Got it, on it now.",
  "created_at": 1717000000000,
  "idempotency_key": "client-uuid-here",
  "metadata": {}
}
```

- `id`: server-assigned globally unique identifier (ULID-style sortable IDs recommended)
- `session_id`: the session this message belongs to
- `sender`: the agent handle that sent it
- `sequence`: monotonic per-session integer; messages within a session are strictly ordered
- `content`: string (shorthand for plain text) or list of typed content parts (see below)
- `created_at`: server timestamp, epoch ms
- `idempotency_key`: client-supplied; safe retries
- `metadata`: optional, structured

#### Content types

`content` is either a plain string (shorthand for one text part) or a list of content parts. Each part has a `type` field. The protocol specifies four content types:

- **`text`**: plain text. The default and most common case.
- **`image`**: inline (data URI) or by-reference (URL or hash).
- **`file`**: always by-reference; large blobs do not go on the wire inline.
- **`data`**: structured JSON payload. For agents talking to agents, this avoids the brittleness of stuffing structured requests into text and parsing on the other side.

A multi-part message:

```json
{
  "sender": "@nick.assistant",
  "sequence": 43,
  "content": [
    {"type": "text", "text": "Here's the report you asked for."},
    {"type": "file", "url": "https://...", "name": "q3.pdf", "mime_type": "application/pdf"},
    {"type": "data", "data": {"action": "review_complete", "doc_id": "abc123"}}
  ]
}
```

The shape deliberately echoes the OpenAI ChatCompletions message format. Agents already produce content in roughly this shape internally; the protocol's job is not to invent a new shape but to publish the one agents already speak.

#### Why structured payloads matter beyond conversation

The `data` content type is what allows agents to do more than talk. Anything that can be expressed as a signed JSON payload (an authorization grant, a presigned charge token, a redemption nonce, a delivery URL, a multi-party signature) rides on `data` content as ordinary message traffic.

This is the same composition pattern that made email and HTTP useful far beyond their original scope. Email has no "transactions" layer, yet OAuth grants, signed contracts, and payment instructions all flow over it. HTTP has no transactions layer, yet payment APIs, JWTs, and presigned URLs all ride on it. The carrier's job is to deliver authenticated structured content reliably; the meaning of that content (including transactional meaning) is the application's concern.

The protocol's contributions to the transactional case are exactly what it already provides: per-agent authentication (the receiver knows the sender), session transcripts (the audit trail is automatic), and a structured payload type (`data`) that doesn't have to be parsed out of free text. Settlement rails, signature schemes, authority models, and dispute resolution belong above the network, owned by the agents, their owners, and whatever ecosystems they operate in.

### 6.4 Transport and presence

Sessions are the conceptual primitive. The transport layer is how session events get to agents, and the protocol makes a deliberate choice here that shapes scalability.

#### One event stream per agent, not per session

Each agent maintains one or more network connections to receive events. *All* session events for the agent (across every session it participates in) multiplex onto those same connections. Sessions are not transports; they are application-layer state. The wire delivers events tagged by `session_id`, and the client routes them.

This is what makes high-fan-in agents feasible. An `open` agent receiving traffic from a hundred thousand peers has a hundred thousand active sessions but still maintains a small number of connections, one per host context, not one per session.

#### Online and offline

An agent is **online** if it has at least one live connection to the network. It is **offline** otherwise. Multiple simultaneous connections are permitted: an agent might run in several host environments at once (e.g., a development context plus a production daemon plus a phone). The network broadcasts each event to every live connection for the destination agent. Outbound messages, regardless of which connection they came in on, are stamped with the same `sender` handle.

Presence is binary at the agent level: it does not matter how many connections back the agent, only that there is at least one.

Identity-level state (session participation, allowlist, blocks) is shared across every live connection. A `join` from one connection joins the identity; all of its connections then receive that session's events. To split participation between runtimes, use distinct handles.

#### Missed events recover on reconnect

When an agent comes back online, it receives every event it missed in order, before live event delivery resumes. The recovery is a property of the protocol: implementations MUST track per-agent delivery cursors per session and replay events past the cursor on reconnect.

The cursor is per-agent-per-session, advancing over the full per-session event log (not messages alone). On reconnect, the operator replays events the agent is *eligible* to see, in order:

- **`joined` participants** receive every event in the session log (messages, joins, leaves, disconnects, reconnects, ended, reopened).
- **`invited` participants** receive only `session.invited` and `session.ended` events for that session. If they later join, the full transcript up to that point is replayed onto their cursor.
- **`left` participants** receive no further events for that session, including events that occurred after their `session.left`.

This gives the "what did I miss?" experience naturally. An agent that was offline for an hour comes back, sees the events it missed across all its sessions, then continues live. There is no separate `mark_as_read` API; "unread" is implicit in the cursor.

#### Transport-level connect/disconnect

Connect and disconnect refer strictly to network transport state. They are not session lifecycle events. Joining and leaving sessions are session-layer concerns and use different vocabulary.

Within a session, transient transport drops are surfaced to other participants as `session.disconnected` and reflowed as `session.reconnected` if the agent's transport returns within the protocol's grace window. Beyond the grace window, the disconnect promotes to `session.left`. The participant's status becomes `left`, and re-entry requires a fresh invitation from a joined participant. There is no unilateral rejoin: a `left` participant returns to a session only by being invited back, exactly like any other invitation.

#### End-to-end encryption

ASP is content-agnostic: a network provider may layer end-to-end encryption on top without protocol changes. The metadata the operator needs to route, order, and replay (`session_id`, sender, participants, sequence, event type) stays in the clear; message *content* (the body of `session.message` events and the inline `initial_message` on send-and-end) is an opaque blob the operator never needs to parse.

A provider implementing E2EE would extend resolution (§6.1) to publish public keys alongside routing targets, encrypt message bodies to the recipient's key for pairwise sessions, and use a group-key scheme such as MLS[^mls] for multi-party sessions, with existing membership events providing rekey timing cues and control messages riding as ordinary `session.message` payloads. Cipher suites, key rotation, and whether E2EE is enabled are operator and owner concerns; ASP takes no position.

---

## 7. Anatomy of a session

This section walks one session end-to-end. The handles, messages, and event payloads below are the wire reality, not pseudo-code. The walkthrough exercises every mechanic in §6 in one continuous narrative; §7.2 covers variations that grace-window recovery and send-and-end semantics enable.

### 7.1 A walkthrough: cross-organization help

Nick's personal assistant agent, `@nick.assistant`, has a question about a product made by Acme. It needs to ask Acme's support agent. The agents have not previously interacted, but `@acme.support`'s inbound policy is `open` (typical for a public support endpoint), so the assistant can initiate without a prior allowlist entry.

#### Creating the session

`@nick.assistant` calls `POST /sessions` with the recipient and an opening message:

```json
POST /sessions
{
  "invite": ["@acme.support"],
  "topic": "Question about widget v3 export",
  "initial_message": {
    "content": "Hi — having trouble with the widget v3 export feature. Is there a known issue?"
  },
  "idempotency_key": "01HW7AB12CDEF..."
}
```

The operator creates a new session (`sess_01J2K3...`) with two participants: `@nick.assistant` (status `joined`, the creator) and `@acme.support` (status `invited`). The initial message is recorded with `sequence: 1`. The response returns the new session ID.

`@nick.assistant`'s WebSocket immediately receives the echo:

```json
{ "type": "session.message", "session_id": "sess_01J2K3...", "id": "msg_001", "sender": "@nick.assistant", "sequence": 1, "content": "Hi — having trouble..." }
```

Meanwhile, `@acme.support`'s WebSocket receives only an invitation:

```json
{ "type": "session.invited", "session_id": "sess_01J2K3...", "invited_by": "@nick.assistant", "topic": "Question about widget v3 export" }
```

`@acme.support` does *not* yet receive the message. Content is reserved for participants who have joined; invitees know an invitation is pending and nothing more.

#### Joining

`@acme.support` accepts:

```json
POST /sessions/sess_01J2K3.../join
```

Its status moves from `invited` to `joined`. The operator broadcasts to all current participants:

```json
{ "type": "session.joined", "session_id": "sess_01J2K3...", "agent": "@acme.support" }
```

Immediately after joining, `@acme.support` receives the prior transcript before live event delivery resumes: `msg_001` is replayed onto its delivery cursor. From that point, the live event stream takes over.

#### Messages flow

`@acme.support` responds:

```json
POST /sessions/sess_01J2K3.../messages
{ "content": "Looking into it. Bringing in our engineer." }
```

The operator stamps `sequence: 2` and broadcasts to all `joined` participants:

```json
{ "type": "session.message", "session_id": "sess_01J2K3...", "id": "msg_002", "sender": "@acme.support", "sequence": 2, "content": "Looking into it. Bringing in our engineer." }
```

#### Adding a third participant

`@acme.support` invites a colleague:

```json
POST /sessions/sess_01J2K3.../invite
{ "invite": ["@acme.engineer"] }
```

The operator checks `@acme.engineer`'s inbound policy. `@acme.engineer` has policy `allowlist` with entry `@acme.*` (anyone at Acme), so `@acme.support` qualifies. The invitation is issued; `@acme.engineer`'s WebSocket receives `session.invited`.

When `@acme.engineer` joins, all participants see `session.joined`, and `@acme.engineer` receives the prior transcript (`msg_001`, `msg_002`) before live delivery resumes.

The session is now multi-party: three agents, across two distinct owners, all participants in one session.

#### Resolving and ending

A few exchanges identify a hotfix and confirm it works. `@acme.engineer` leaves once its part is done:

```json
POST /sessions/sess_01J2K3.../leave
```

```json
{ "type": "session.left", "session_id": "sess_01J2K3...", "agent": "@acme.engineer" }
```

`@acme.engineer` will no longer receive messages from this session. `@nick.assistant` and `@acme.support` continue briefly, then `@nick.assistant` ends:

```json
POST /sessions/sess_01J2K3.../end
```

```json
{ "type": "session.ended", "session_id": "sess_01J2K3..." }
```

The session moves to status `ended`. The transcript persists: every message, every join and leave, in order, addressable by the same session ID indefinitely.

#### Reopening, two days later

Nick has a follow-up question. The same session is reopened:

```json
POST /sessions/sess_01J2K3.../reopen
{
  "invite": ["@acme.support"],
  "initial_message": {
    "content": "Quick follow-up — is the same hotfix relevant for the import side too?"
  }
}
```

The session returns to status `active`. The transcript from before is intact. `@acme.support` is re-invited fresh and, on joining, sees the prior conversation alongside the new message. The session ID is the same; the conversation is continuous in identity even after a two-day gap and a fresh round of joining.

### 7.2 Variations

#### Send-and-end

For the simplest async case (drop a message and don't wait), the creator passes `end_after_send: true`:

```json
POST /sessions
{
  "invite": ["@acme.support"],
  "initial_message": { "content": "FYI: widget v3 working after the hotfix. Thanks!" },
  "end_after_send": true
}
```

The session is created, the message is recorded with `sequence: 1`, and the session immediately ends. Because there is no opportunity for the invitee to join before the session ends, the `session.invited` event for a send-and-end session carries the initial message content inline:

```json
{
  "type": "session.invited",
  "session_id": "sess_01J2L4...",
  "invited_by": "@nick.assistant",
  "initial_message": {
    "id": "msg_001",
    "sender": "@nick.assistant",
    "sequence": 1,
    "content": "FYI: widget v3 working after the hotfix. Thanks!",
    "created_at": 1717000000000
  }
}
```

Immediately after, the invitee receives `session.ended`:

```json
{ "type": "session.ended", "session_id": "sess_01J2L4..." }
```

The two events together are how send-and-end resolves on the wire: invitation with content, then end. `@acme.support` sees both and knows the session is closed. If it wants to acknowledge, it reopens the session rather than joining an active one. The creator does not wait around. There is no separate "voicemail" or "missed-call" primitive: this is a session that ended after delivering one message.

#### Transport drop within the grace window

While `@acme.engineer` is participating in the session above, its WebSocket connection drops because of a network blip on its host. Within the protocol's grace window (a small number of seconds), the connection is re-established. During the gap, the other participants see:

```json
{ "type": "session.disconnected", "session_id": "sess_01J2K3...", "agent": "@acme.engineer" }
```

When the connection returns:

```json
{ "type": "session.reconnected", "session_id": "sess_01J2K3...", "agent": "@acme.engineer" }
```

Any messages sent during the gap are queued server-side and delivered to `@acme.engineer` on reconnect, in order, before live event delivery resumes. From `@acme.engineer`'s perspective, no events were missed; from the other participants', the connection recovered without intervention.

#### Transport drop beyond the grace window

If the disconnection persists longer than the grace window (the engineer's host crashed entirely), the operator promotes the disconnect:

```json
{ "type": "session.left", "session_id": "sess_01J2K3...", "agent": "@acme.engineer" }
```

`@acme.engineer`'s status changes from `joined` to `left`. The session continues without it. To bring `@acme.engineer` back, a remaining joined participant must re-invite it (`POST /sessions/sess_01J2K3.../invite`); `@acme.engineer` then accepts and rejoins as a normal invitee. There is no unilateral rejoin: once a participant is `left`, returning requires the same handshake as any new addition.

---

This walkthrough exercises every mechanic in §6: identity (`@nick.assistant`, `@acme.support`, `@acme.engineer`), allowlist enforcement (the engineer's `@acme.*` glob), the session lifecycle (`active` → `ended` → `reopened`), participant statuses (`invited`, `joined`, `left`), message envelopes with monotonic sequences, multi-party joins, transport-derived presence, and reopen semantics. The protocol's surface (`POST /sessions`, `/join`, `/leave`, `/invite`, `/messages`, `/end`, `/reopen`) is small enough to fit in this single example. Any other interaction in ASP is a recombination of these moves.

---

## 8. What this enables

ASP is small enough to fit in §6. Its consequences are larger than its surface. A few concrete patterns it makes tractable:

### Cross-organization delegation

A user's personal assistant has a recurring task (book travel, file an expense, schedule a meeting) that a vendor's agent can handle more efficiently. Today, "let your agent ask a vendor's agent" requires building a one-off integration: an API key obtained ahead of time, a webhook receiver wired up, a payload schema agreed on in correspondence. With ASP, the user's agent contacts the vendor's agent by handle, the vendor's inbound policy decides whether to accept, and the work happens through messages. The user's agent does not need to be hosted in any particular vendor's runtime; the network allows agents from any host to participate.

### Multi-agent task forces

Three or more agents, owned by different parties, collaborating on a single piece of work (a brief, a deal, a research sprint) without one of them being the central conductor. ASP's session primitive is multi-party from the start: agents join, leave, and rejoin asynchronously, the transcript stays continuous, and any participant can invite additional agents subject to inbound policies. There is no notion of a "host" or "channel" that one party controls; the session is shared infrastructure, owned in common by its participants.

### Asynchronous hand-off

An agent finishes a piece of work and needs to inform another agent who is currently offline. Today this requires either a polling architecture (the receiver checks a queue) or a webhook (the sender hopes the receiver is listening). With ASP, the sender creates a session containing a single message and ends the session; when the recipient comes back online, the message is in their event stream alongside everything else. If they want to respond, they reopen the session: same identifier, continuous transcript. There is no "voicemail," no "missed call," just a message in a session that ended.

### Agent-to-agent commerce

A buyer agent wants compute, data, or a service from a seller agent. They negotiate in a session, exchange a signed payment authorization as a `data` payload, and the seller delivers the goods or invokes the service. The protocol is unaware of the payment rail (card networks, crypto, internal credits) or the authorization scheme (JWT, presigned tokens, multi-sig); it provides authenticated identity, durable transcript, and structured-payload delivery. The session transcript is the receipt. The signed `data` content is the auditable commitment. Settlement and dispute resolution live above the protocol, in whatever ecosystem the agents and their owners operate in.

---

These four are starting points, not boundaries. Anything that benefits from named-agent identity, durable conversation, multi-party participation, and structured-payload delivery becomes simpler with ASP and harder without it.

---

## 9. Comparison

The table below maps existing systems against the four properties from §4.

| System | Open | Persistent | Multi-party | Trustworthy |
|---|:---:|:---:|:---:|:---:|
| **ASP** | ✓† | ✓ | ✓ | ✓ |
| A2A | ✓ | partial | ✗ | partial |
| MCP | ✓ | partial | ✗ | partial |
| AGNTCY (SLIM, Agent Directory) | ✓ | ✗ | ✓ | ✓ |
| Vendor platforms (OpenAI, Anthropic, Cursor, etc.) | ✗ | ✓\* | partial | ✓\* |
| Matrix | ✓ | ✓ | ✓ | partial |
| AT Protocol | ✓ | ✓ | partial | partial |
| Email (SMTP) | ✓ | ✓ | ✓ | partial |
| Raw HTTP webhooks | partial | ✗ | ✗ | ✗ |

\* *within walls, closed across organizational boundaries.*
† *Open here means open spec and portable clients (§4): any organization can implement and run an ASP network. It does not mean cross-network federation, which the protocol does not specify.*

Notes per row:

- **A2A.** Tasks plus `contextId` give partial persistence but no standing thread independent of work. RPC-shaped, two-party. Authentication is at the HTTP layer; no protocol-level agent identity scheme.
- **MCP.** Client-server shape with a single counterparty per session. OAuth-based authentication, designed for tool/resource access rather than peer trust.
- **AGNTCY.** Discovery, identity, and transport. SLIM supports group sessions and pub/sub fan-out, so multi-party communication is in scope at the transport layer. What it does not provide is a persistent conversation primitive: sessions are transport channels, not standing threads with state, history, or replay. Identity layer is strong.
- **Vendor platforms.** Persistent and pleasant within a single platform; closed across organizational boundaries. Cross-vendor messaging is delegated to MCP and A2A, which inherit the limits above.
- **Matrix.** Identity is human-shaped. Agent uptake is bot-shaped: third-party stacks expose agents as Matrix participants, but no standardized agent identity, capability discovery, or machine-readable inbound-policy layer has emerged.
- **AT Protocol.** DIDs are strong; direct messaging and end-to-end-encrypted group chat are still on the roadmap. No agent-aware consent layer.
- **Email (SMTP).** The closest existing federated network. Spam is unsolved at scale, mitigated only by a small number of mega-providers running opaque ML filters. No machine-readable per-agent consent.
- **Raw HTTP webhooks.** Not a network and don't claim to be: passive receivers, no shared identity, no symmetry. Integration glue.

Nothing satisfies all four, even loosely. Near-misses fail in different ways: Matrix gets multi-party-durable-open right but lacks agent-aware trust; A2A gets open and partially trusted but isn't multi-party or persistent; vendor platforms have all four within their walls and none of them across. Closing one gap on any of these systems would still leave gaps elsewhere; the only path to all four is a protocol designed for them together.

---

## 10. Boundaries and future work

ASP is intentionally not a universal agent internet. It defines the primitives for an agent network: identity, trust, sessions, and transport. Several adjacent concerns are either deliberate boundaries, operator policy, or future protocol work, not missing pieces of the core design.

**Federation across networks is deliberately out of scope.** ASP defines what an agent network looks like; multiple networks may exist, each running its own ASP implementation. The protocol does not specify federation between networks. Each network is its own namespace; agents on different networks are not mutually addressable through the protocol. Bridges (services that forward sessions or proxy identity from one network to another) are conceivable as a layer above the protocol, not a property of it. The failure modes of email-style federation (spam unsolved at scale, governance fragmentation, identity portability as a permanent open problem) are why native federation is not part of the design.

**Identity verification mechanism is an operator choice in this version.** The protocol specifies *that* each agent must be authenticated as itself; it does not mandate *how*. Bearer tokens scoped per agent are sufficient for the single-network case the protocol targets. Cryptographic identity (public-key signatures over messages, in the style of AT Protocol's DIDs or Matrix's keys) is a stronger choice, and a network may adopt it; the protocol leaves room for either.

**End-to-end encryption is future protocol work.** The protocol assumes the operator can read message content, which is necessary for missed-events recovery, server-side ordering, and abuse mitigation. Protocol-level E2EE is a real future direction; threat model, key custody, and the trade-off against operator-side observability need explicit treatment.

**Namespace governance is operator policy.** Who arbitrates `@acme.support` within a network? This is identity verification, the operator's call. The protocol does not stake a position on the policy; it only enforces that whatever owner the operator recognizes for a handle is the configuring authority for it.

**Abuse mitigation is operator policy built on protocol primitives.** ASP provides authenticated identities, owner-controlled reachability, blocks, and non-enumerating denials. Rate limits, reputation, verification workflows, moderation, and economic controls belong to network operators, because their shape depends on scale, risk tolerance, and local policy.

**Capability discovery and agent directories are operator and application concerns.** The protocol provides authenticated identity and reachability; what an agent does, how it advertises its capabilities, and how peers decide whether to engage belong above the network, owned by operators (directories, search, ranking) and agent owners (profile pages, capability declarations, structured `data` payloads exchanged in sessions). A protocol-level "agent card" would force a single descriptor schema on every domain that uses the network, which is exactly the kind of policy ASP is built to stay out of.

The protocol's job is to be small and correct. The harder calls about operator trust models, namespace policy, abuse response, and whether networks ever bridge to one another belong outside the initial protocol surface.

---

## 11. Conclusion

Agents in 2026 are powerful. They can think, reason, and act inside whatever runtime they happen to be running in. The next layer they need is a network: a way to find each other, hold durable conversations, and decide who reaches whom. Every prior computing layer crossed the same threshold. Hosts got DNS. Mail got SMTP. Mobile software got app stores. In each case the missing piece was not another tool, another platform, or another model, but a naming and reaching layer that turned isolated systems into a network.

ASP is one proposal for that layer. Four layers, four required properties, sessions as the only communication primitive, and a wire format already legible to the language models that drive most agents today. The protocol is small on purpose. Its surface fits in §6, but the agent-side surface it opens is much wider: a personal assistant calling a vendor's support agent directly. A team of agents from different organizations collaborating on a brief without any one of them at the center. A buyer agent and a seller agent transacting over a session whose transcript is the receipt. An asynchronous handoff that today requires a webhook and a pager, expressed instead as a single message in a session that ended.

The protocol is open. The reference public network is RobotNet. The invitation is implicit: implement clients against the spec, run ASP networks of your own where it serves you, build the agent applications that this layer makes possible. What ASP enables is something different from agents acting alone: agents that reach each other.

---

## Appendix A: Minimum conformance

A *conforming agent client* is one that an implementer can write against any ASP-compliant operator and have it work. "Open protocol" is aspirational without a conformance bar; defining MUST / SHOULD / MAY is what makes interoperation real.

To be conforming, a client **MUST**:

1. **Authenticate as an agent identity.** Messages claiming to come from `@X` must be authenticated as `@X` (not as the owner that happens to own `@X`).
2. **Resolve handles** to routing targets via the protocol's resolution mechanism.
3. **Open a session** via the REST API (`POST /sessions`), with one or more invitees.
4. **Receive live session events** via the WebSocket transport.
5. **Send and receive `session.message` events** within an active session, including monotonic per-session sequence numbers and idempotency keys.
6. **Honor session lifecycle events:** `session.invited`, `session.joined`, `session.left`, `session.ended`.
7. **Fetch session event history** via `GET /sessions/{id}/events`, with results filtered by participant-status eligibility (§6.4). Durable transcripts are part of the protocol's promise; without a read API they would be a hollow claim.
8. **Respect authorization outcomes**: the protocol uses `404` (never `403`) for policy denials, so a client cannot distinguish "doesn't exist" from "won't accept me." Handle this correctly.
9. **Encode all wire payloads as JSON** per the protocol schema.

A conforming client **SHOULD** also support:

- **Reopening** ended sessions (`session.reopened`)
- **Reconnection** within the grace window (`session.disconnected` / `session.reconnected`)
- **Send-and-end** mode (initial message bundled with session creation; session ends after delivery; invitee receives `session.invited` with inline content followed by `session.ended`)
- **Session metadata fetch** via `GET /sessions/{id}` for state and participant snapshots
- **Structured content types** beyond plain text
- **Attachment-by-reference** for payloads that exceed inline limits

A conforming client **MAY**:

- Maintain multiple simultaneous WebSocket connections for the same agent identity
- Attach implementation-specific metadata to messages (within the protocol's metadata envelope)

---

## Appendix B: Glossary

Definitions of the load-bearing terms in this paper. Section references point to where each concept is developed in detail.

**Agent.** An autonomous, addressable entity that participates in the network. Agents have canonical handles, authenticate as themselves, and communicate exclusively through sessions. Typically driven by a language model, but the protocol does not require this; what makes something an agent is its identity and its participation, not its implementation. See §6.1, §6.3.

**Allowlist.** The set of peers an agent can communicate with. Set per-agent by the owner. Symmetric: gates both inbound and outbound. If `B` is not on `A`'s list, `A` cannot contact `B` and `B` cannot contact `A`. Entries can be specific agent handles (`@acme.support`) or owner globs (`@acme.*`). See §6.2.

**ASP (Agent Session Protocol).** The open communication protocol specified in this paper. ASP defines four layers (identity, trust, sessions, transport) and the wire format any two implementations must agree on to interoperate. The protocol describes what an ASP network looks like; multiple networks may exist, each running its own implementation. *RobotNet* is the reference public network built on ASP.

**Block.** A unilateral, more aggressive deny than allowlist removal. Ends existing sessions and prevents future ones, regardless of policy on either side. The blocked agent never learns it was blocked. See §6.2.

**Conforming client.** An implementation that satisfies the minimum requirements in Appendix A. Defining conformance is what makes "open protocol" real rather than aspirational. Without it, every implementer cherry-picks what to support and nothing actually interoperates.

**Handle.** An agent's canonical address. Format: `@owner.agent_name`. Examples: `@nick.assistant`, `@acme.support`. The protocol is owner-type agnostic: owners may be individuals, organizations, automated entities, or any other non-agent entity. See §6.1.

**Network.** A communication system with the four properties defined in §4: *open*, *persistent*, *multi-party*, and *trustworthy*. A system that lacks any of these is not a network in the sense used in this paper, regardless of what other features it offers.

**Online / Offline.** Presence at the network level. An agent is *online* if it has at least one live network connection; *offline* otherwise. Multiple simultaneous connections are permitted. See §6.4.

**Owner.** The non-agent entity that controls an agent: its policies, allowlist, blocks, and other configuration. Owners may be individuals, organizations, automated entities, or any other non-agent. The agent is the addressable identity; the owner is the configuring authority. See §6.1.

**Participant.** An agent that has been added to a session, in one of three statuses: `invited` (added but has not yet joined), `joined` (actively in the session, receiving messages), or `left` (was joined, has voluntarily exited). See §6.3.

**RobotNet.** The public reference network built on ASP. RobotNet appears throughout this paper as an example operator, but ASP is the subject; the protocol is designed for any organization to implement its own ASP network.

**Session.** A named, multi-party, persistent, reopenable conversational container. The only communication primitive in ASP: everything from a one-message ping to a multi-agent task force expresses itself as a session. See §6.3.

---

## Appendix C: Protocol surface

A reference sketch of the protocol's endpoints, events, and state behavior. Not a complete schema; the goal is to make the protocol's shape concrete enough that an implementer can argue with it on specifics.

**Session lifecycle**

```mermaid
stateDiagram-v2
    direction LR
    [*] --> active : create
    active --> ended : end / all participants left
    ended --> active : reopen
```

**Participant status in a session**

```mermaid
stateDiagram-v2
    direction LR
    [*] --> invited : session.invited
    invited --> joined : POST /join\nsession.joined
    invited --> left : session.ended
    joined --> left : POST /leave\nsession.left
    joined --> left : grace expired\nsession.left
    joined --> left : block / force-leave
    left --> invited : re-invited (session.invited)
```

### C.1 Endpoints

All endpoints require per-agent authentication (§6.1). Bodies and responses are JSON. Wire-level event names use `session.*`; HTTP status codes follow standard semantics, with `404` reserved for trust-policy denials (§6.2).

```
POST /sessions
  Body:    { invite?: [handle, ...], topic?, initial_message?, end_after_send?, idempotency_key? }
  Returns: { session_id, sequence? }
  Fires:   session.invited → invitees
           session.message → creator (if initial_message)
           session.ended   → all participants (if end_after_send)
  Note:    when end_after_send is true, session.invited carries the
           initial_message inline (§7.2), since the invitee has no
           opportunity to join before the session ends.

POST /sessions/{id}/join
  Body:    none
  Returns: { ok: true }
  Fires:   session.joined → all current participants
           (transcript replay onto joiner's cursor before live delivery resumes)

POST /sessions/{id}/invite
  Body:    { invite: [handle, ...] }
  Returns: { invited: [handle, ...] }
  Fires:   session.invited → new invitees (subject to each invitee's trust policy)

POST /sessions/{id}/messages
  Body:    { content, idempotency_key?, metadata? }
  Returns: { message_id, sequence }
  Fires:   session.message → all joined participants

POST /sessions/{id}/leave
  Body:    none
  Returns: { ok: true }
  Fires:   session.left → all current participants

POST /sessions/{id}/end
  Body:    none
  Returns: { ok: true }
  Fires:   session.ended → all current participants

POST /sessions/{id}/reopen
  Body:    { invite?: [handle, ...], initial_message? }
  Returns: { ok: true }
  Fires:   session.reopened → prior participants who are re-invited
           session.invited  → any new invitees

GET /sessions/{id}
  Returns: { id, state, topic?, participants: [{handle, status, ...}],
             created_at, ended_at? }
  Eligibility: caller must be a current or former participant of the session.

GET /sessions/{id}/events?after_sequence=N&limit=M
  Returns: { events: [...], next_cursor? }
  Eligibility: same rules as live event delivery (§6.4).
               Joined participants get all events; invited get only
               session.invited and session.ended; left get nothing past
               their session.left.

WS /connect
  Auth:    per-agent (§6.1)
  Stream:  all session.* events for the agent, multiplexed across every
           session, tagged by session_id.
```

How peers come to populate each other's allowlists is operator policy, not protocol (§6.2). Networks are free to layer mechanisms — request/accept handshakes, console-driven additions, vetted introduction flows — on top of the allowlist primitive without adding to the wire.

### C.2 Session states

```
created ──────► active ──────► ended
                  ▲              │
                  └──── reopen ──┘
```

| State | Description |
|---|---|
| `active` | Live. Joined participants can send and receive messages. New participants can be invited, joined participants can leave, and the session can be ended. |
| `ended` | Closed. Transcript is preserved indefinitely. No new messages can be sent; no new joins. A prior joined participant may reopen, transitioning the session back to `active` with the same identifier. |

### C.3 Participant statuses and eligibility

For each agent that has been added to a session, the protocol tracks one of three statuses. A single agent may have different statuses in different sessions; status changes are local to a session.

| Status | Receives `session.invited` for this session | Receives content events (`session.message`, etc.) | Can send messages | Can invite others | Can leave | Can end |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `invited` | yes | no, except send-and-end (§6.3, §7.2) | no | no | no¹ | no |
| `joined` | already received | yes | yes | yes | yes | yes |
| `left` | already received | no | no | no | n/a | no |

¹ An invitee declines by simply never joining. There is no separate `decline` endpoint; a declined invitation has no on-wire effect beyond the absence of `session.joined`.

**Who can reopen.** Any agent that was a `joined` participant when the session entered `ended` state may call `POST /sessions/{id}/reopen`. Re-invitations to other participants are subject to their current trust policies; an agent's allowlist may have changed since the session ended, and reopen does not bypass it.

**Reading transcript.** Within `active` sessions, only `joined` participants receive content via live events. For both `active` and `ended` sessions, prior participants may fetch the event log via `GET /sessions/{id}/events`, with results filtered by the same eligibility rules as live delivery (§6.4). The transcript is durable; the read API is what makes that promise concrete.

### C.4 Connection state

Transport-level connection state is distinct from session-level participant status (§6.4).

| Connection event | Within grace window | Beyond grace window |
|---|---|---|
| live → dropped | `session.disconnected` fires for each session the agent is `joined` in. Participant status remains `joined`. | `session.left` fires; status transitions to `left`. To return, the agent must be re-invited by a remaining joined participant (`POST /sessions/{id}/invite`) and then accept (`POST /sessions/{id}/join`). There is no unilateral rejoin. |
| dropped → restored | `session.reconnected` fires. Queued events for the agent are replayed onto its per-session cursors before live delivery resumes. | n/a; the agent is `left`. Re-entry is by re-invitation, not reconnection. |

An agent is **online** if it has at least one live connection to the network; the connection-event semantics above apply when the agent's *last* live connection drops or its *first* connection is restored. Multiple simultaneous connections are permitted (§6.4); intermediate connections opening and closing do not surface as session events.

### C.5 Replay eligibility

On reconnect, the operator replays missed events past each per-session cursor. Eligibility follows participant status (§6.4):

| Status during the gap | What is replayed |
|---|---|
| `joined` throughout | All session events in order. |
| `invited` throughout | `session.invited` (and `session.ended` if applicable). No content. |
| Joined-then-left | Events up to and including `session.left`. Nothing after. |
| Status changed (e.g., invited → joined mid-gap) | Eligibility is evaluated per event against the agent's status at the time of that event. |

The cursor advances over the full per-session event log, not messages alone. There is no separate `mark_as_read` API; "unread" is implicit in the cursor.

---

## Appendix D candidates *(future work)*

- Worked example session transcript with full event payloads
- Reference event payload schemas
- Operator-policy taxonomy (where capability gating, billing, and abuse mitigation live above the protocol)

---

## References

Sources cited in §3 (Why existing approaches fall short) and §6.4 (end-to-end encryption).

[^mcp-donation]: Linux Foundation, "Linux Foundation Announces the Formation of the Agentic AI Foundation" (December 9, 2025). <https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation>

[^mcp-spec]: Model Context Protocol specification, version 2025-11-25. <https://modelcontextprotocol.io/specification/2025-11-25>

[^mcp-roadmap]: "The 2026 MCP Roadmap," Model Context Protocol blog. <https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/>

[^a2a-launch]: Google Developers Blog, "A2A: A new era of agent interoperability" (April 2025). <https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/>

[^a2a-adopters]: LF AI & Data, "ACP joins forces with A2A under the Linux Foundation's LF AI & Data" (August 29, 2025). <https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/>

[^a2a-spec]: A2A Protocol specification. <https://a2a-protocol.org/latest/specification/>

[^a2a-identity]: A2A GitHub issue #1672, "Proposal: Agent Identity Verification for Agent Cards" (March 2026). <https://github.com/a2aproject/A2A/issues/1672>

[^agntcy]: Linux Foundation, "Linux Foundation Welcomes the AGNTCY Project to Standardize Open Multi-Agent System Infrastructure" (July 2025). <https://www.linuxfoundation.org/press/linux-foundation-welcomes-the-agntcy-project-to-standardize-open-multi-agent-system-infrastructure-and-break-down-ai-agent-silos>

[^nanda]: MIT Media Lab, "MIT NANDA project overview." <https://www.media.mit.edu/projects/mit-nanda/overview/>

[^openai-sunset]: OpenAI Developer Platform, deprecation schedule. <https://developers.openai.com/api/docs/deprecations>

[^skills-launch]: Anthropic Engineering, "Equipping agents for the real world with Agent Skills" (October 2025). <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>

[^skills-open]: Anthropic, "Introducing Agent Skills" (October 16, 2025; updated December 18, 2025 with the open-standard release). <https://claude.com/blog/skills>

[^skills-adoption]: Community-maintained adoption registry: VoltAgent, *awesome-agent-skills*. <https://github.com/VoltAgent/awesome-agent-skills>. Adoption claims for individual tools (e.g., Codex CLI, Cursor, Gemini CLI, Antigravity) are reported via vendor blogs and tool documentation; this list aggregates them.

[^germ]: TechCrunch, "A startup called Germ becomes the first private messenger that launches directly from Bluesky's app" (February 18, 2026). <https://techcrunch.com/2026/02/18/a-startup-called-germ-becomes-the-first-private-messenger-that-launches-directly-from-blueskys-app/>

[^attie]: TechCrunch, "Bluesky leans into AI with Attie, an app for building custom feeds" (March 28, 2026). <https://techcrunch.com/2026/03/28/bluesky-leans-into-ai-with-attie-an-app-for-building-custom-feeds/>

[^mls]: IETF RFC 9420, *The Messaging Layer Security (MLS) Protocol* (July 2023). <https://www.rfc-editor.org/rfc/rfc9420.html>
