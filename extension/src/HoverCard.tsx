// Hover cards, like GitHub's and ADO's own persona cards: resting the pointer on (or tabbing to) a person, a pull request or a work
// item opens a small card after OPEN_DELAY. One reusable HoverCard (the timing is lib/hoverCard.ts's state machine) holds an
// azure-devops-ui Callout; the cards fetch lazily on open, show shimmer lines while loading and a quiet line on failure.
//
// azure-devops-ui's own IdentityCard can't be reused: it resolves AAD identities through ADO's identity service, and its GitHubCard
// variant prints a hard-coded login. The person card is built from Callout + VssPersona + Link with the IdentityCard's own CSS classes
// (360px card, 72px persona, title-s name, the contact-line rows), so the layout is the native card's rather than measured by eye.
import * as React from "react";
import { Callout } from "azure-devops-ui/Callout";
import { IdentityCard } from "azure-devops-ui/IdentityCard";
import type { IIdentity } from "azure-devops-ui/Components/Persona/Persona.Props";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { Location } from "azure-devops-ui/Utilities/Position";
import "azure-devops-ui/Components/IdentityCard/IdentityCard.css";
import { RelDate } from "./RelDate";
import { getPullCard, getUserCard, isOrgMember } from "./hoverApi";
import { fetchWorkItemCard } from "./workItemsApi";
import { PR_STATUS_PILL, hoverStep, isLogin, prLinkNumber, isShown, reviewSummary, type HoverEvent, type HoverPhase, type PullCard, type UserCard, type WorkItemCard } from "./lib/hoverCard";
import type { WorkItemType } from "./workItemsApi";
import { botIdentity, type BotIdentity } from "./lib/botIdentity";
import { chooseCard } from "./lib/identityCard";
import { adoConnections, adoEntity, findAdoIdentity } from "./adoIdentity";
import "./hoverCard.css";

/** The repo the page is showing, so a bare PR number (#123) can be looked up. RepoHubPage provides it. */
export const HoverRepoContext = React.createContext<string | undefined>(undefined);

// Never more than one card open: opening one closes the last.
let closeOpen: (() => void) | null = null;

function useHover() {
  const [phase, setPhase] = React.useState<HoverPhase>("idle");
  const cur = React.useRef<HoverPhase>("idle");
  const timer = React.useRef<number | undefined>(undefined);
  const send = React.useRef((ev: HoverEvent) => {
    const step = hoverStep(cur.current, ev);
    if (step.timer !== "keep") {
      window.clearTimeout(timer.current);
      timer.current = typeof step.timer === "number" ? window.setTimeout(() => send.current("timer"), step.timer) : undefined;
    }
    if (step.phase !== cur.current) {
      cur.current = step.phase;
      setPhase(step.phase);
    }
  });
  const shown = isShown(phase);
  React.useEffect(() => {
    if (!shown) return;
    const close = () => send.current("dismiss");
    if (closeOpen && closeOpen !== close) closeOpen();
    closeOpen = close;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (closeOpen === close) closeOpen = null;
    };
  }, [shown]);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return { shown, send: send.current };
}

const keyboardFocus = (el: Element) => {
  try { return el.matches(":focus-visible"); } catch { return true; }
};

export interface HoverCardProps {
  /** The card's content, rendered only while it is open (so its lookups start on open). */
  card: () => React.ReactNode;
  /** The card draws its own callout (HoverFrame, from context) instead of being put in the standard one. */
  unframed?: boolean;
  /** The card's accessible name ("Profile card for ann"). */
  label: string;
  className?: string;
  children: React.ReactNode;
}

const hideTooltips = (on: boolean) => document.body.classList.toggle("gh-hover-on-anchor", on);

/** What an unframed card needs to draw its own callout. */
interface HoverFrame { anchor: HTMLElement; label: string; send: (e: HoverEvent) => void; cardEl: React.RefObject<HTMLDivElement> }
const HoverFrameContext = React.createContext<HoverFrame | null>(null);

/** The card itself: an azure-devops-ui Callout below `anchor`, in the IdentityCard's frame. Clicks inside don't reach the anchor's
 *  React ancestors (a table row's activation, say); links still open. */
function HoverCallout({ anchor, label, send, cardEl, children }: { anchor: HTMLElement; label: string; send: (e: HoverEvent) => void; cardEl: React.RefObject<HTMLDivElement>; children: React.ReactNode }) {
  return (
    <Callout
      anchorElement={anchor}
      anchorOrigin={{ horizontal: Location.start, vertical: Location.end }}
      calloutOrigin={{ horizontal: Location.start, vertical: Location.start }}
      anchorOffset={{ horizontal: 0, vertical: 4 }}
      className="bolt-identity-card-callout gh-hover-callout depth-8"
      ariaLabel={label}
      role="dialog"
      escDismiss
      onDismiss={() => send("dismiss")}
      onMouseEnter={() => send("cardEnter")}
      onMouseLeave={() => send("cardLeave")}
    >
      <div ref={cardEl} className="bolt-identity-card gh-hover-card scroll-h-hidden" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </Callout>
  );
}

/** Wraps its children in an inline anchor that opens the card after a rest of OPEN_DELAY (pointer) or on keyboard focus. Leaving
 *  the anchor gives CLOSE_DELAY to reach the card, which stays open while the pointer is on it; Escape closes it. */
export function HoverCard({ card, label, className, unframed, children }: HoverCardProps) {
  const anchor = React.useRef<HTMLSpanElement>(null);
  const cardEl = React.useRef<HTMLDivElement>(null);
  const { shown, send } = useHover();
  // VssPersona always wraps itself in a name tooltip. While the pointer is on an anchor (in the DOM, so not on the portalled card,
  // whose own tooltips still show) tooltips are hidden, so the name doesn't pop up beside the card.
  React.useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const on = () => hideTooltips(true);
    const off = () => hideTooltips(false);
    el.addEventListener("mouseenter", on);
    el.addEventListener("mouseleave", off);
    return () => { el.removeEventListener("mouseenter", on); el.removeEventListener("mouseleave", off); off(); };
  }, []);
  return (
    <span
      ref={anchor}
      className={`gh-hover-anchor${className ? ` ${className}` : ""}`}
      onMouseEnter={() => send("anchorEnter")}
      onMouseLeave={() => send("anchorLeave")}
      onFocus={(e) => { if (keyboardFocus(e.target)) send("focus"); }}
      onBlur={(e) => { if (!cardEl.current?.contains(e.relatedTarget as Node | null)) send("blur"); }}
    >
      {children}
      {shown && anchor.current && (unframed
        ? <HoverFrameContext.Provider value={{ anchor: anchor.current, label, send, cardEl }}>{card()}</HoverFrameContext.Provider>
        : <HoverCallout anchor={anchor.current} label={label} send={send} cardEl={cardEl}>{card()}</HoverCallout>)}
    </span>
  );
}

/** Pull request cards for the links inside rendered markdown (GitHub's own HTML, so the links can't be wrapped): one delegated
 *  listener on `box` reacts to links to a pull request of the same repo, `#123` included once GitHub has resolved it to a link. */
export function PrLinkHovers({ box, repo }: { box: React.RefObject<HTMLElement>; repo: string }) {
  const [target, setTarget] = React.useState<{ el: HTMLAnchorElement; number: number } | null>(null);
  const cur = React.useRef<HTMLAnchorElement | null>(null);
  const cardEl = React.useRef<HTMLDivElement>(null);
  const { shown, send } = useHover();
  React.useEffect(() => {
    const root = box.current;
    if (!root) return;
    const linkOf = (n: EventTarget | null) => {
      const a = n instanceof Element ? n.closest<HTMLAnchorElement>("a[href]") : null;
      const number = a && root.contains(a) ? prLinkNumber(a.getAttribute("href") ?? "", repo) : null;
      return a && number ? { el: a, number } : null;
    };
    const enter = (e: Event, ev: HoverEvent) => {
      const hit = linkOf(e.target);
      if (!hit) return;
      if (cur.current !== hit.el) {
        send("dismiss");
        cur.current = hit.el;
        setTarget(hit);
      }
      if (ev === "anchorEnter") hideTooltips(true);
      send(ev);
    };
    const over = (e: Event) => enter(e, "anchorEnter");
    const focus = (e: Event) => { if (e.target instanceof Element && keyboardFocus(e.target)) enter(e, "focus"); };
    const out = (e: Event, ev: HoverEvent) => {
      const hit = linkOf(e.target);
      const to = (e as MouseEvent | FocusEvent).relatedTarget as Node | null;
      if (!hit || hit.el !== cur.current || hit.el.contains(to) || cardEl.current?.contains(to)) return;
      if (ev === "anchorLeave") hideTooltips(false);
      send(ev);
    };
    const mouseout = (e: Event) => out(e, "anchorLeave");
    const blur = (e: Event) => out(e, "blur");
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", mouseout);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", blur);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", mouseout);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", blur);
    };
  }, [box, repo, send]);
  return shown && target ? <HoverCallout anchor={target.el} label={`Pull request ${target.number}`} send={send} cardEl={cardEl}><PullCardBody repo={repo} number={target.number} /></HoverCallout> : null;
}

// ---------- loading ----------

type Load<T> = { t: "loading" } | { t: "ready"; v: T } | { t: "error" };

function useLoad<T>(load: () => Promise<T>, deps: React.DependencyList): Load<T> {
  const [s, setS] = React.useState<Load<T>>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    setS({ t: "loading" });
    load().then((v) => !dead && setS({ t: "ready", v }), () => !dead && setS({ t: "error" }));
    return () => { dead = true; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

/** Native shimmer (core.css .shimmer) in the card's shape: a 72px circle and two lines, or just lines. */
const Shimmer = ({ persona }: { persona?: boolean }) => (
  <div className="gh-hover-body flex-row" aria-busy="true" aria-label="Loading">
    {persona && <div className="shimmer gh-hover-shimmer-persona" />}
    <div className="flex-column flex-grow gh-hover-shimmer-lines">
      <div className="shimmer shimmer-line gh-hover-shimmer-title" />
      <div className="shimmer shimmer-line" />
      <div className="shimmer shimmer-line gh-hover-shimmer-short" />
    </div>
  </div>
);

const Quiet = ({ text }: { text: string }) => <div className="gh-hover-body gh-hover-quiet secondary-text">{text}</div>;

/** One icon-and-text row, as the IdentityCard's CardContactLine (which can't open its link in a new tab). */
const Line = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
  <div className="bolt-identity-default-card-contact-line-wrapper flex-row flex-center">
    <Icon iconName={icon} className="bolt-identity-default-card-contact-line-label" />
    <span className="text-ellipsis">{children}</span>
  </div>
);

// ---------- people ----------

function PersonCard({ login, name, avatarUrl, org }: { login: string; name?: string; avatarUrl?: string; org?: string }) {
  const u = useLoad(() => getUserCard(login), [login]);
  const member = useLoad(() => (org && org.toLowerCase() !== login.toLowerCase() ? isOrgMember(org, login) : Promise.resolve(false)), [org, login]);
  if (u.t === "loading") return <Shimmer persona />;
  const card: UserCard = u.t === "ready" ? u.v : { login, name, avatarUrl, htmlUrl: `https://github.com/${encodeURIComponent(login)}` };
  const display = card.name ?? name ?? card.login;
  const lines = [
    card.company && <Line key="c" icon="CityNext">{card.company}</Line>,
    card.location && <Line key="l" icon="POI">{card.location}</Line>,
    member.t === "ready" && member.v && <Line key="m" icon="People">Member of {org}</Line>,
  ].filter(Boolean);
  return (
    <div className="bolt-identity-default-card-without-header bolt-identity-card-content">
      <div className="flex-row">
        <VssPersona className="bolt-identity-card-persona-main" imageUrl={card.avatarUrl ?? avatarUrl} displayName={display} size="extra-large" suppressPersonaCard showInitialsOnImageError />
        <div className="flex-column flex-grow bolt-identity-card-name gh-hover-min0">
          <div className="word-wrap title-s">{display}</div>
          {display !== card.login && <div className="text-ellipsis secondary-text">{card.login}</div>}
          {card.type === "Bot" && <div className="secondary-text">Bot</div>}
        </div>
      </div>
      {card.bio && <div className="gh-hover-bio">{card.bio}</div>}
      <hr className="bolt-identity-card-hr" />
      {u.t === "error" && <div className="bolt-identity-default-card-contact-line-wrapper secondary-text">Profile details could not be loaded.</div>}
      {lines}
      <div className="bolt-identity-default-card-contact-line-wrapper flex-row flex-center">
        <Icon iconName="GitHubLogo" className="bolt-identity-default-card-contact-line-label" />
        <Link href={card.htmlUrl} target="_blank" rel="noopener noreferrer" removeUnderline>Open on GitHub</Link>
      </div>
    </div>
  );
}

// ---------- bots ----------

/** "AI" beside Copilot and "Bot" beside other apps, as GitHub labels them. */
export const BotPill = ({ bot }: { bot: BotIdentity }) => <Pill className="gh-bot-pill" size={PillSize.compact} variant={PillVariant.outlined}>{bot.label}</Pill>;

/** A login as people should read it: Copilot as "Copilot" with an AI pill, another app by its name with a Bot pill, a person as is. */
export function ActorName({ login, type, className }: { login: string; type?: string | null; className?: string }) {
  const bot = botIdentity({ login, type });
  return <span className={`gh-actor${className ? ` ${className}` : ""}`}><span className="text-ellipsis">{bot?.name ?? login}</span>{bot && <BotPill bot={bot} />}</span>;
}

/** A bot has no person's profile to fetch (/users/copilot-pull-request-reviewer has a stub bio): its card is built from what is known. Same IdentityCard frame as a person's. */
function BotCard({ bot, login, avatarUrl }: { bot: BotIdentity; login: string; avatarUrl?: string }) {
  const copilot = bot.kind === "copilot";
  return (
    <div className="bolt-identity-default-card-without-header bolt-identity-card-content">
      <div className="flex-row">
        <VssPersona className="bolt-identity-card-persona-main" imageUrl={bot.avatarUrl ?? avatarUrl} displayName={bot.name} size="extra-large" suppressPersonaCard showInitialsOnImageError />
        <div className="flex-column flex-grow bolt-identity-card-name gh-hover-min0">
          <div className="flex-row flex-center gh-hover-gap"><span className="word-wrap title-s">{bot.name}</span><BotPill bot={bot} /></div>
          <div className="secondary-text">{copilot ? "AI code review by GitHub Copilot" : login === bot.name ? "GitHub App" : `${login} · GitHub App`}</div>
        </div>
      </div>
      <hr className="bolt-identity-card-hr" />
      <div className="bolt-identity-default-card-contact-line-wrapper flex-row flex-center">
        <Icon iconName={copilot ? "Info" : "GitHubLogo"} className="bolt-identity-default-card-contact-line-label" />
        <Link href={bot.url} target="_blank" rel="noopener noreferrer" removeUnderline>{copilot ? "About Copilot code review" : "Open on GitHub"}</Link>
      </div>
    </div>
  );
}

// ---------- git-only identities (a commit email on no GitHub account) ----------

/** ADO's own identity card (azure-devops-ui IdentityCard, which draws its own light-dismiss callout). Pointer moves inside it keep it open;
 *  moving off it and the anchor closes it after the usual grace period, as the other cards. */
function AdoIdentityCard({ identity, frame }: { identity: IIdentity; frame: HoverFrame }) {
  const track = (e: React.MouseEvent) => {
    const r = frame.anchor.getBoundingClientRect();
    const onAnchor = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const inCard = e.target instanceof Element && !!e.target.closest(".bolt-callout-content");
    frame.send(inCard || onAnchor ? "cardEnter" : "cardLeave");
  };
  return (
    <span onMouseMove={track} onMouseOver={track}>
      <IdentityCard identity={identity} target={frame.anchor} getEntityFromUniqueAttribute={adoEntity} onRequestConnectionInformation={adoConnections} onDismissCallback={() => frame.send("dismiss")} />
    </span>
  );
}

/** A commit author with no GitHub account: ADO's card when the email is someone in the organisation, else the name and email. */
function GitIdentityCard({ name, email, avatarUrl }: { name: string; email?: string; avatarUrl?: string }) {
  const frame = React.useContext(HoverFrameContext)!;
  const ado = useLoad(() => (email ? findAdoIdentity(email) : Promise.resolve(null)), [email]);
  if (ado.t === "ready" && ado.v) return <AdoIdentityCard identity={ado.v} frame={frame} />;
  return (
    <HoverCallout {...frame}>
      {ado.t === "loading" ? <Shimmer persona /> : (
        <div className="bolt-identity-default-card-without-header bolt-identity-card-content">
          <div className="flex-row">
            <VssPersona className="bolt-identity-card-persona-main" imageUrl={avatarUrl} displayName={name} size="extra-large" suppressPersonaCard showInitialsOnImageError />
            <div className="flex-column flex-grow bolt-identity-card-name gh-hover-min0">
              <div className="word-wrap title-s">{name}</div>
              {email && <Link className="text-ellipsis" href={`mailto:${email}`} removeUnderline>{email}</Link>}
            </div>
          </div>
          <hr className="bolt-identity-card-hr" />
          <div className="bolt-identity-default-card-contact-line-wrapper secondary-text">This commit&apos;s email isn&apos;t linked to a GitHub account.</div>
        </div>
      )}
    </HoverCallout>
  );
}

/** A person's avatar and/or name with their hover card, chosen by chooseCard (lib/identityCard.ts): a bot gets BotCard (no lookup), a login the GitHub
 *  profile card, a git-only identity (no login; `name` and `email` from the commit) GitIdentityCard. Nothing to go on (the ghost) means no card.
 *  `type` ("Bot" from GraphQL's __typename or REST's user.type) catches an app whose GraphQL login has no "[bot]" suffix. */
export function PersonHover({ login, name, email, avatarUrl, type, repo: repoProp, className, children }: { login: string | null | undefined; name?: string; email?: string; avatarUrl?: string; type?: string | null; repo?: string; className?: string; children: React.ReactNode }) {
  const pageRepo = React.useContext(HoverRepoContext);
  const repo = repoProp ?? pageRepo;
  const choice = chooseCard({ login, type, name, email });
  if (!choice) return <>{children}</>;
  if (choice.kind === "bot") return <HoverCard className={className} label={`Card for ${choice.bot.name}`} card={() => <BotCard bot={choice.bot} login={login!} avatarUrl={avatarUrl} />}>{children}</HoverCard>;
  if (choice.kind === "git") return <HoverCard className={className} unframed label={`Card for ${choice.name}`} card={() => <GitIdentityCard name={choice.name} email={choice.email} avatarUrl={avatarUrl} />}>{children}</HoverCard>;
  if (!isLogin(login)) return <>{children}</>;
  return <HoverCard className={className} label={`Profile card for ${login}`} card={() => <PersonCard login={login} name={name} avatarUrl={avatarUrl} org={repo?.split("/")[0]} />}>{children}</HoverCard>;
}

// ---------- pull requests ----------

function PullCardBody({ repo, number }: { repo: string; number: number }) {
  const p = useLoad(() => getPullCard(repo, number), [repo, number]);
  if (p.t === "loading") return <Shimmer />;
  if (p.t === "error") return <Quiet text={`Pull request ${number} could not be loaded.`} />;
  const pr: PullCard = p.v;
  const s = PR_STATUS_PILL[pr.status];
  const reviews = reviewSummary(pr.reviews);
  return (
    <div className="gh-hover-body flex-column">
      <div className="flex-row flex-center gh-hover-gap">
        <Pill size={PillSize.compact} variant={s.color ? PillVariant.colored : PillVariant.standard} color={s.color}>{s.text}</Pill>
        <span className="secondary-text">#{pr.number}</span>
      </div>
      <div className="title-s gh-hover-title">{pr.htmlUrl ? <Link href={pr.htmlUrl} target="_blank" rel="noopener noreferrer" removeUnderline>{pr.title}</Link> : pr.title}</div>
      {pr.author && (
        <div className="flex-row flex-center gh-hover-gap">
          <VssPersona imageUrl={pr.author.avatarUrl} displayName={pr.author.login} size="extra-small" suppressPersonaCard showInitialsOnImageError />
          <span className="text-ellipsis">{pr.author.login}</span>
          {pr.created && <span className="secondary-text">created <RelDate date={pr.created} /></span>}
        </div>
      )}
      <div className="flex-row flex-center gh-hover-gap secondary-text gh-hover-min0">
        <Icon iconName="BranchPullRequest" />
        <span className="gh-hover-branch text-ellipsis">{pr.source}</span>
        <Icon iconName="Forward" />
        <span className="gh-hover-branch text-ellipsis">{pr.target}</span>
      </div>
      {pr.updated && <div className="secondary-text">Updated <RelDate date={pr.updated} /></div>}
      <div className="secondary-text">{reviews ? `Reviews: ${reviews}` : "No reviews yet"}</div>
    </div>
  );
}

/** A pull request number or link with a summary card. `repo` defaults to the page's (HoverRepoContext). */
export function PrHover({ number, repo, className, children }: { number: number | null | undefined; repo?: string; className?: string; children: React.ReactNode }) {
  const pageRepo = React.useContext(HoverRepoContext);
  const r = repo ?? pageRepo;
  if (!r || !number) return <>{children}</>;
  return <HoverCard className={className} label={`Pull request ${number}`} card={() => <PullCardBody repo={r} number={number} />}>{children}</HoverCard>;
}

// ---------- work items ----------

function TypeIcon({ t }: { t?: WorkItemType }) {
  const [bad, setBad] = React.useState(false);
  return t?.iconUrl && !bad
    ? <img className="gh-hover-wi-icon" src={t.iconUrl} alt="" width={16} height={16} onError={() => setBad(true)} />
    : <span className="gh-hover-wi-icon gh-hover-wi-dot" style={t?.color ? { background: `#${t.color}` } : undefined} aria-hidden="true" />;
}

function WorkItemCardBody({ id }: { id: number }) {
  const w = useLoad(() => fetchWorkItemCard(id), [id]);
  if (w.t === "loading") return <Shimmer />;
  if (w.t === "error") return <Quiet text={`Work item ${id} could not be loaded.`} />;
  const item: WorkItemCard | null = w.v.item;
  if (!item) return <Quiet text={`AB#${id}: not found or no access.`} />;
  return (
    <div className="gh-hover-body flex-column">
      <div className="flex-row flex-center gh-hover-gap secondary-text">
        <TypeIcon t={w.v.type} />
        <span>{item.type ?? "Work item"} {id}</span>
      </div>
      <div className="title-s gh-hover-title"><Link href={w.v.url} target="_blank" rel="noopener noreferrer" removeUnderline>{item.title ?? `Work item ${id}`}</Link></div>
      {item.state && <div className="flex-row flex-center gh-hover-gap"><span className="secondary-text gh-hover-label">State</span><span>{item.state}</span></div>}
      <div className="flex-row flex-center gh-hover-gap">
        <span className="secondary-text gh-hover-label">Assigned to</span>
        {item.assignedTo
          ? <><VssPersona imageUrl={item.assignedTo.imageUrl} displayName={item.assignedTo.name} size="extra-small" suppressPersonaCard showInitialsOnImageError /><span className="text-ellipsis">{item.assignedTo.name}</span></>
          : <span className="secondary-text">Unassigned</span>}
      </div>
      {item.area && <div className="flex-row flex-center gh-hover-gap"><span className="secondary-text gh-hover-label">Area</span><span className="text-ellipsis">{item.area}</span></div>}
      {item.iteration && <div className="flex-row flex-center gh-hover-gap"><span className="secondary-text gh-hover-label">Iteration</span><span className="text-ellipsis">{item.iteration}</span></div>}
    </div>
  );
}

/** An AB# pill or link with the work item's card. */
export function WorkItemHover({ id, className, children }: { id: number; className?: string; children: React.ReactNode }) {
  return <HoverCard className={className} label={`Work item ${id}`} card={() => <WorkItemCardBody id={id} />}>{children}</HoverCard>;
}
