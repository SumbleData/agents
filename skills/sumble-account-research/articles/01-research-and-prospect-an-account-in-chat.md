# Research and prospect an account without leaving the chat

The scoring and CRM skills build apps you run in a coding agent. This one is different: a **skill you install in your AI chat**. Name an account, or hand it your book, and it comes back with a brief that says where you stand, how hard to work it, who to call and what to say.

**Skill:** [`sumble-account-research`](../SKILL.md). Upload it to Claude, ChatGPT, or Gemini.

*Account scoring tells you [which companies](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md). People scoring tells you [who inside them](../../sumble-people-scoring/articles/01-people-scoring-use-cases.md). This skill is the motion that works one of those accounts end to end.*

## TLDR
- It's a chat skill rather than a coding-agent skill: a folder you upload to Claude, ChatGPT, or Gemini. No local app, no terminal.
- It asks one question before it touches a tool: deep dive on a specific account, or prioritize across your accounts. Then it works to a finished brief without interrupting you.
- It reads whatever you already have connected (Gong, Salesforce, HubSpot, your product analytics) and asks only for what's missing, so a pasted call note or a CSV is as good as an integration.
- The brief is decision-first: an exec summary, where the account stands with you, a High / Medium / Low priority with the reasons, who to contact and what to say, then the data that powered it.
- It needs the Sumble MCP connected. Without it you get a plan; with it you get real people, dated signals, and messages you can send.

## What it does

Open a chat and the skill walks the play a good rep runs but rarely has time for:

1. **Asks one question.** Deep dive on a specific account, or prioritize across your accounts. That's the only time it interrupts you, and it skips even that if your first message already answers it. Name a company and it takes the deep dive. Ask which accounts to work and it pulls your CRM-synced list from Sumble and ranks it on two things kept separate: how well each account fits, and whether something just happened there.
2. **Takes stock of what's connected.** It reads the connectors available to it, names them back to you, and asks only for the gaps: call recordings, CRM history, marketing touches, product usage, past email. Where a system isn't connected it asks for the artifact instead. Paste the notes from your last call, or drop a CSV of the opportunity with its loss reason. Internal context outranks anything external.
3. **Confirms how you sell.** It pulls your company profile from Sumble, plays back your sales plays and the technologies you complement and displace, and asks you to upload whatever you actually sell from: battlecards, a persona one-pager, emails that landed. Your material wins wherever it disagrees with the profile, and your play names go into the brief verbatim.
4. **Rebuilds the account from the outside.** Tech, teams, people, headcount, hiring signals and ICP fit from the Sumble API, read through your plays. Then a web pass on the company and on every person it plans to name, because Sumble tells you what they're hiring for, not what they've said out loud.
5. **Delivers the brief.** By default an interactive HTML page, described below. Ask for outreach sequences, a deck, or call prep instead and it builds that from the same research. Only at the end does it offer to reveal emails and phone numbers and push contacts into your sequencer.

It never spends a credit or sends anything without you in the loop.

## What the brief contains

Every brief runs in the same order, decision first and data after. A rep who reads only the first box should know what to do. A skeptic who reads to the end should be able to check every number.

1. **Exec summary.** The thesis, three or four numbers with a direction, then three lines: where it stands, the priority, the next step. The next step is a name, not a role.
2. **Current status.** What has already happened between you and this account: open and closed opportunities with the loss reason, calls, signups, threads, each dated and tagged with the system it came from. If there's no history it says so in one line, because a cold account changes the first sentence of every message. Their stack sits here too, with confirmed adoption separated from tools that only show up in job postings.
3. **Priority.** High, Medium or Low, defined by what you do next: this week, this quarter, or park it. The reasons split into fit and trigger, and there's a line on what would change the call.
4. **Next step.** Why now, three ways in with the recommended one marked, who to contact first with their reporting lines, one card per sales play, and a copy-ready message for each door.
5. **Raw data.** The signal footprint and a receipt for every number above, with the link that proves it.
6. **Limits and method.** The query, which of your systems were connected and came back empty, and what the brief can't see.

Two rules hold it together. Every claim traces to a Sumble field, a record from your own systems, or a cited web source. And nothing you say out loud names where you learned it: a message asserts what you believe is a priority for them, never "I saw you're hiring."

When you prioritize across accounts the same shape applies to the book: a ranked board where every row carries a priority band and a reason, and the top few open into a compressed version of the brief above. The section-by-section build rules live in [`references/deep-dive-brief.md`](../references/deep-dive-brief.md) and [`references/prioritization-brief.md`](../references/prioritization-brief.md).

## It's a web-app skill, not a coding-agent skill

The account-scoring, people-scoring, and CRM-cleaning skills run inside a coding agent (Claude Code, Codex, Cursor) and generate a local Python app you tune with sliders. This one has no app to build; the work is the conversation. So it lives where you chat: Claude, ChatGPT, or Gemini.

Two consequences worth knowing up front:

- **It's Markdown plus two templates.** `SKILL.md` carries the method, the `references/` folder carries the detail, and `assets/` holds the two HTML templates the briefs render into. Upload the folder as a skill, or paste `SKILL.md` and the references as custom instructions on a platform without a skills feature.
- **It's only as capable as its tool access.** The skill is instructions; the data comes from the Sumble MCP. Where the chat can reach Sumble, it runs the real motion; where it can't, it drafts the brief from whatever you paste in. The question to ask on any platform is whether the chat can call the Sumble MCP.

## Install it

You'll need a **Sumble account** ([sumble.com](https://sumble.com)) to connect the Sumble MCP; you authorize it with a sign-in, so there's no key to copy. Claude installs the skill straight from a repository; ChatGPT and Gemini need the `SKILL.md` text from the [`sumble-account-research`](../SKILL.md) skill.

**Claude (desktop, web, mobile, or Cowork): the most complete path.**
1. **Customize → Plugins → Personal**, press **+**, choose **Add marketplace → Add from a repository**, and enter `SumbleData/agents`. Install the **sumble-account-research** plugin. Nothing to download, and one marketplace covers every Sumble skill. *(Skills require a Pro, Team, or Enterprise plan; on Team/Enterprise an admin may need to enable them.)*
2. Open the marketplace's **...** menu and turn on **Sync**, so later improvements to the skill reach you without a reinstall.
3. **Settings → Connectors → add the Sumble MCP** (remote URL `https://mcp.sumble.com`) and complete the sign-in flow. This is what lets the skill pull real data.
4. In any chat, just ask: *"Use account research on Vanta"* or *"Help me pick which accounts in my territory to work."* Skills trigger on intent, on every surface above.

**ChatGPT: upload it as a Skill.**
ChatGPT now supports Skills natively: **Skills → Create → Upload**, and select the same zip. *(Skills are available on ChatGPT Business, Enterprise, Healthcare, and Edu; once uploaded, ChatGPT runs it on intent or when you @-mention it.)* On a plan without Skills, replicate it as a Custom GPT instead: **Explore GPTs → Create**, paste the `SKILL.md` text into the GPT's **Instructions**, and append the `references/` files (or add them to the GPT's knowledge). Either way, connect Sumble, as a **connector / app** or as an **action** on a Custom GPT, so ChatGPT can call the Sumble MCP. Without it, it still drafts the brief from context you provide.

**Google Gemini: build a Gem.**
Gemini's closest concept is a **Gem** (a saved custom assistant): create one and paste `SKILL.md` (plus the `references/` files) into its instructions. Gemini's connector access is more limited, so unless you can wire Sumble in, treat the Gem as a guided researcher that structures the play and drafts outreach from data you paste, and connect Sumble the moment the platform allows it.

If your platform can't reach Sumble at all yet, the skill is still useful as the method; it just can't fetch on its own.

## Operate it

A few things make it feel fast and keep it honest:

- **Hand it your own material, every run.** It pulls your company profile from Sumble each time, but what a seller has in Highspot, Seismic or a deck on their laptop is more specific and more current than anything the profile holds. Battlecards change the play badges, a persona one-pager changes who lands in the buying group, and emails that worked change the voice of every drafted message.
- **Prioritizing rolls straight into the work.** Rank your book and it deep-dives the top three and builds their briefs, rather than stopping to ask which one you meant. Ask for the rest at the close.
- **It checks people are still there.** Every name is verified as currently at the company before it goes on the page. A departed champion gets dropped, not listed, and a stale title gets corrected and marked.
- **Nothing leaves without your say-so.** Credit-spending steps are flagged first, contact details are revealed only for the top two or three people and only if you want to act, and nothing is pushed to a sequencer without your confirmation.

## The part that compounds

Most account research dies in a graveyard of browser tabs: you find the signal, you mean to write the email, the day moves on. This skill collapses finding, deciding, drafting, and sending into one conversation, and hands you a brief you can put on screen in front of the customer, because every number on it carries its receipt.

Point it at the accounts your [account score](../../sumble-account-scoring/articles/01-account-score-should-tell-a-rep-what-to-do.md) flagged and the people your [people score](../../sumble-people-scoring/articles/01-people-scoring-use-cases.md) ranked, and the loop is closed: the model tells you where the revenue is, and this skill walks you to the first conversation that goes after it.
