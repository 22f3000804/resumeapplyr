import type { ResumeBasics } from "../../core/schemas/resume";
import { EMPTY_PROFILE, missingProfileFields, type Profile, profileSchema } from "../../core/schemas/profile";
import { DEFAULT_SETTINGS, type Settings, settingsPatchSchema, settingsSchema } from "../../core/schemas/settings";
import { type ServiceContext, parseJson } from "./context";

export class ProfileService {
  constructor(private readonly ctx: ServiceContext) {}

  get(): Profile {
    const row = this.ctx.db.get<{ data: string }>("SELECT data FROM profile WHERE id = 1");
    if (!row) return EMPTY_PROFILE;
    const parsed = profileSchema.safeParse(parseJson(row.data, {}));
    return parsed.success ? parsed.data : EMPTY_PROFILE;
  }

  save(input: unknown): Profile {
    const profile = profileSchema.parse(input);
    this.ctx.db.run(
      "INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      JSON.stringify(profile),
      this.ctx.now().toISOString(),
    );
    this.ctx.events.changed("profile");
    return profile;
  }

  missing(): string[] {
    return missingProfileFields(this.get());
  }

  /**
   * At first extraction the CV is the best source for contact details. Fills only empty fields, and
   * only while the profile has no name or email yet, so it never overwrites what the user typed.
   */
  prefillFromResume(basics: ResumeBasics | undefined): boolean {
    if (!basics) return false;
    const current = this.get();
    if (current.firstName || current.contactEmail) return false;

    const [first, ...rest] = (basics.name ?? "").trim().split(/\s+/);
    const city = (basics.location ?? "").split(",")[0]?.trim() ?? "";
    const next: Profile = {
      ...current,
      firstName: current.firstName || first || "",
      lastName: current.lastName || rest.join(" "),
      contactEmail: current.contactEmail || basics.email || "",
      phone: current.phone || basics.phone || "",
      website: current.website || basics.website || "",
      linkedin: current.linkedin || basics.linkedin || "",
      github: current.github || basics.github || "",
      city: current.city || city,
    };
    const parsed = profileSchema.safeParse(next);
    if (!parsed.success) return false;
    this.save(parsed.data);
    return true;
  }
}

export class SettingsService {
  constructor(private readonly ctx: ServiceContext) {}

  get(): Settings {
    const row = this.ctx.db.get<{ data: string }>("SELECT data FROM settings WHERE id = 1");
    // Edge ships with Windows; Chrome may not be installed there.
    if (!row) return { ...DEFAULT_SETTINGS, browserChannel: process.platform === "win32" ? "msedge" : "chrome" };
    const parsed = settingsSchema.safeParse(parseJson(row.data, {}));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  update(patch: unknown): Settings {
    const next = settingsSchema.parse({ ...this.get(), ...settingsPatchSchema.parse(patch) });
    this.ctx.db.run(
      "INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      JSON.stringify(next),
      this.ctx.now().toISOString(),
    );
    this.ctx.events.changed("settings");
    return next;
  }
}
