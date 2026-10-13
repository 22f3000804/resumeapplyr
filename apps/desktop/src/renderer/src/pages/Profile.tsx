import { useEffect, useRef, useState } from "react";
import { missingProfileFields, type Profile, profileSchema, SALARY_PERIODS, type SalaryPreference } from "../../../core/schemas/profile";
import { call, useRpc } from "../api";
import { Button, Checkbox, ErrorNote, Loading, NumberField, PageHeader, Section, SelectField, TextField, useAction } from "../components/ui";

const PERIOD_LABEL: Record<(typeof SALARY_PERIODS)[number], string> = { yearly: "a year", monthly: "a month", hourly: "an hour" };
const NOT_DISCLOSED = "Prefer not to disclose";

const listText = (items: string[]) => items.join(", ");
const parseList = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function ProfilePage() {
  const profile = useRpc("profile.get", [], ["profile"]);
  if (profile.error) return <ErrorNote error={profile.error} onRetry={profile.reload} />;
  if (!profile.data) return <Loading />;
  return <ProfileForm saved={profile.data} />;
}

function ProfileForm({ saved }: { saved: Profile }) {
  const [base, setBase] = useState<Profile>(saved);
  const [draft, setDraft] = useState<Profile>(saved);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Comma-separated lists are edited as text so commas and spaces can be typed freely.
  const [authorized, setAuthorized] = useState(listText(saved.authorizedToWorkIn));
  const [preferred, setPreferred] = useState(listText(saved.preferredLocations));
  const { busy, run } = useAction();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = (profile: Profile) => {
    setBase(profile);
    setDraft(profile);
    setAuthorized(listText(profile.authorizedToWorkIn));
    setPreferred(listText(profile.preferredLocations));
  };
  // A save from elsewhere (the CV filling in contact details) shows up unless you're mid-edit.
  useEffect(() => {
    if (!dirtyRef.current) load(saved);
  }, [saved]);
  const discard = () => {
    load(base);
    setDirty(false);
    setErrors({});
  };

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const text = (key: keyof Profile, label: string, extra: { hint?: string; type?: "text" | "email" | "url" | "tel"; autoComplete?: string } = {}) => (
    <TextField
      label={label}
      value={String(draft[key] ?? "")}
      onChange={(value) => set(key, value as never)}
      error={errors[key]}
      {...extra}
    />
  );

  const save = async () => {
    const candidate = { ...draft, authorizedToWorkIn: parseList(authorized), preferredLocations: parseList(preferred) };
    const parsed = profileSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.path.length > 1 ? `Row ${Number(issue.path[1]) + 1}: ${issue.message}` : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const result = await run("save", () => call("profile.save", parsed.data), "Profile saved.");
    if (result) {
      load(result);
      setDirty(false);
    }
  };

  const missing = missingProfileFields(draft);
  const salaries = draft.salaryPreferences;
  const references = draft.references;
  const setSalary = (index: number, patch: Partial<SalaryPreference>) =>
    set(
      "salaryPreferences",
      salaries.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <>
      <PageHeader
        title="Profile"
        lead="What application forms ask for. The agent fills forms from here, and asks you when something isn't covered. It stays on this computer."
      />

      {missing.length ? (
        <div className="notice notice-accent">
          <p>Applications can't go out until you add your {missing.join(", ")}.</p>
        </div>
      ) : null}
      {Object.keys(errors).length ? (
        <div className="notice notice-accent" role="alert">
          <p>Some fields need fixing before this can be saved. They're marked below.</p>
        </div>
      ) : null}

      <Section title="Name and contact">
        <div className="grid-3">
          {text("firstName", "First name", { autoComplete: "given-name" })}
          {text("lastName", "Last name", { autoComplete: "family-name" })}
          {text("contactEmail", "Email for applications", { type: "email", autoComplete: "email" })}
          {text("phone", "Phone", { type: "tel", autoComplete: "tel", hint: "With the country code, like +44 7700 900123." })}
          {text("linkedin", "LinkedIn")}
          {text("website", "Website or portfolio")}
          {text("github", "GitHub")}
        </div>
      </Section>

      <Section title="Address" description="Some forms ask for it in full. Most only want the city and country.">
        <div className="grid-3">
          {text("street", "Street", { autoComplete: "address-line1" })}
          {text("aptUnit", "Flat, apartment or unit", { autoComplete: "address-line2" })}
          {text("city", "City", { autoComplete: "address-level2" })}
          {text("state", "State, county or region", { autoComplete: "address-level1" })}
          {text("zipCode", "Postcode or ZIP", { autoComplete: "postal-code" })}
          {text("country", "Country", { autoComplete: "country-name" })}
        </div>
      </Section>

      <Section title="Where you can work" description="The agent skips jobs that need a visa you don't have, and answers right-to-work questions from here.">
        <div className="grid-2">
          <TextField
            label="Countries you can work in without sponsorship"
            value={authorized}
            onChange={(value) => {
              setAuthorized(value);
              setDirty(true);
            }}
            error={errors.authorizedToWorkIn}
            hint="Separate with commas: United Kingdom, Ireland."
          />
          <TextField
            label="Places you'd like to work"
            value={preferred}
            onChange={(value) => {
              setPreferred(value);
              setDirty(true);
            }}
            error={errors.preferredLocations}
            hint="Cities or countries, separated by commas. Leave empty, or write Anywhere, for no preference."
          />
          {text("visaStatus", "Visa or residence status", { hint: "Only if forms should mention it, e.g. “Graduate visa until 2027”." })}
          <div className="stack" style={{ paddingTop: 22 }}>
            <Checkbox label="I need visa sponsorship" checked={draft.requiresSponsorship} onChange={(v) => set("requiresSponsorship", v)} />
            <Checkbox label="I'm willing to relocate" checked={draft.willingToRelocate} onChange={(v) => set("willingToRelocate", v)} />
          </div>
        </div>
      </Section>

      <Section
        title="Salary"
        description="Used when a form insists on a figure. Without a range that fits, the agent asks you instead of guessing."
        actions={
          salaries.length < 5 ? (
            <Button
              small
              onClick={() =>
                set("salaryPreferences", [
                  ...salaries,
                  { appliesTo: salaries.length ? "" : "Any role", minAmount: null, maxAmount: null, currency: "GBP", period: "yearly" },
                ])
              }
            >
              Add a range
            </Button>
          ) : null
        }
      >
        {errors.salaryPreferences ? <p className="field-error">{errors.salaryPreferences}</p> : null}
        {salaries.length === 0 ? <p className="muted">No ranges yet.</p> : null}
        {salaries.map((row, index) => (
          <div className="entry" key={index}>
            <div className="grid-4" style={{ gridTemplateColumns: "minmax(0, 2fr) repeat(4, minmax(0, 1fr)) auto", alignItems: "end" }}>
              <TextField label="For" value={row.appliesTo} onChange={(v) => setSalary(index, { appliesTo: v })} placeholder="Senior roles" />
              <NumberField label="From" value={row.minAmount} onChange={(v) => setSalary(index, { minAmount: v })} min={0} />
              <NumberField label="To" value={row.maxAmount} onChange={(v) => setSalary(index, { maxAmount: v })} min={0} />
              <TextField label="Currency" value={row.currency} onChange={(v) => setSalary(index, { currency: v.toUpperCase().slice(0, 3) })} placeholder="GBP" />
              <SelectField
                label="Per"
                value={row.period}
                onChange={(v) => setSalary(index, { period: v })}
                options={SALARY_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
              />
              <Button small variant="ghost" onClick={() => set("salaryPreferences", salaries.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="References"
        description="Only given when a form asks for them. Let your referees know first."
        actions={
          references.length < 3 ? (
            <Button small onClick={() => set("references", [...references, { name: "", relationship: "", company: "", email: "", phone: "" }])}>
              Add a reference
            </Button>
          ) : null
        }
      >
        {errors.references ? <p className="field-error">{errors.references}</p> : null}
        {references.length === 0 ? <p className="muted">No references yet.</p> : null}
        {references.map((ref, index) => (
          <div className="entry" key={index}>
            <div className="entry-head">
              <span className="label">{ref.name || `Reference ${index + 1}`}</span>
              <Button small variant="ghost" onClick={() => set("references", references.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
            <div className="grid-3">
              {(["name", "relationship", "company", "email", "phone"] as const).map((key) => (
                <TextField
                  key={key}
                  label={{ name: "Name", relationship: "How you know them", company: "Company", email: "Email", phone: "Phone" }[key]}
                  value={ref[key]}
                  onChange={(v) => set("references", references.map((r, i) => (i === index ? { ...r, [key]: v } : r)))}
                />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Equal opportunity questions"
        description={`Some employers ask these to monitor fairness in hiring. Forms get exactly what you write here; “${NOT_DISCLOSED}” declines.`}
      >
        <div className="grid-3">
          {text("eeoGender", "Gender")}
          {text("eeoRace", "Race")}
          {text("eeoEthnicity", "Ethnicity")}
          {text("eeoHispanicOrLatino", "Hispanic or Latino (US forms)")}
          {text("eeoVeteranStatus", "Veteran status")}
          {text("eeoDisabilityStatus", "Disability")}
        </div>
      </Section>

      {dirty ? (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <p>You have unsaved changes</p>
          <Button onClick={discard}>Discard</Button>
          <Button variant="primary" busy={busy === "save"} onClick={save}>
            Save profile
          </Button>
        </div>
      ) : null}
    </>
  );
}
