// Azure DevOps' own directory, through the host's identity service (the one its identity picker uses), for a commit whose email is
// on no GitHub account: if the email is someone in the organisation, the hover card is ADO's native identity card.
import * as SDK from "azure-devops-extension-sdk";
import type { IIdentity, IIdentityConnections } from "azure-devops-ui/Components/Persona/Persona.Props";
import { pickAdoIdentity } from "./lib/identityCard";

const SERVICE = "ms.vss-features.identity-service";
interface IdentityService {
  searchIdentitiesAsync(query: string, identityTypes?: string[], operationScopes?: string[], queryTypeHint?: string): Promise<IIdentity[]>;
  getConnections(identity: IIdentity, getDirectReports?: boolean): Promise<IIdentityConnections>;
}
const service = () => SDK.getService<IdentityService>(SERVICE);

const byEmail = new Map<string, Promise<IIdentity | null>>();
/** The organisation's user with exactly this email, or null. Cached for the session; a failure answers null and is not cached. */
export function findAdoIdentity(email: string): Promise<IIdentity | null> {
  const key = email.trim().toLowerCase();
  let p = byEmail.get(key);
  if (!p) {
    p = service().then((s) => s.searchIdentitiesAsync(email, ["user"], ["ims", "source"])).then((r) => pickAdoIdentity(email, r));
    byEmail.set(key, p);
    p.catch(() => byEmail.delete(key));
  }
  return p.catch(() => null);
}

/** IdentityCard's lookups, as azure-devops-extension-api's PeoplePickerProvider makes them (that module is AMD, so it is not imported). */
export const adoEntity = (entityId: string): Promise<IIdentity> => service().then((s) => s.searchIdentitiesAsync(entityId, ["user"], ["ims", "source"], "uid")).then((r) => r[0]);
export const adoConnections = (identity: IIdentity | undefined, directReports?: boolean): Promise<IIdentityConnections> =>
  identity ? service().then((s) => s.getConnections(identity, directReports)) : Promise.resolve({});
