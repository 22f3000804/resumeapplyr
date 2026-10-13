<!-- Adapted from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License. -->
# Form filling

Applications often span several pages. For each page:

## Identify and fill

1. **Enumerate fields**: a `browser_snapshot` narrowed to the form container. Each input, textarea,
   select, checkbox and radio carries a label and a `ref` for `browser_click` / `browser_type` /
   `browser_select_option`.
2. **Map fields** to profile and CV data by label, placeholder and name.
3. **Fill** by `ref`:
   - Text → `browser_type` (or `browser_fill_form` for several at once)
   - Selects → `browser_select_option`
   - Checkboxes / radios → `browser_click`
   - CV upload → fetch the tailored variant to the scratch folder,
     `resumeapplyr-api GET /api/resumes/variants/<id>/pdf --out "$RESUMEAPPLYR_TEMP/<key>-resume.pdf"`,
     then `browser_file_upload` that path.
   - Dates → the format the field asks for
4. **Custom widgets** (date pickers, autocompletes, rich-text editors): narrow the snapshot to just
   that widget's container to get a `ref`.

## Special fields

All paths refer to `GET /api/user`.

- **Name** → `user.firstName`, `user.lastName`.
- **Email** → `user.contactEmail`. Always this one - never an address seen anywhere else.
- **Address** → `user.street`, `aptUnit`, `city`, `state`, `zipCode`, `country`.
- **Phone** → `user.phone`. **Links** → `user.linkedin`, `github`, `website`.
- **Salary** → a caller-supplied `salaryExpectation` wins. Else `user.salaryPreferences[]`, each
  `{ appliesTo, minAmount, maxAmount, currency, period }`: pick the entry whose `appliesTo` best fits
  this job (a single generic entry fits all). Range fields → min-max; a single field → `maxAmount`
  (else `minAmount`). Convert the period when the form asks in another unit (yearly ≈ monthly × 12
  ≈ hourly × 2080). Dropdowns → the closest bracket. Nothing fits → check `GET /api/answers` for
  `salary`, else ask the user (`kind: "salary"`, `answerKey: "salary"`).
- **Start date / notice period** → a saved answer (`start_date`, `notice_period`) if there is one,
  else `autoApply.defaultStartDate`.
- **Cover letter** (a text area or a file field labelled cover letter) → the `cover-letter` skill
  with `source` set to the calling skill. Text area → paste it. File field → write
  `{"text":"<letter>"}` to `$RESUMEAPPLYR_TEMP/<key>-letter.json`, run
  `resumeapplyr-api POST /api/cover-letters/pdf --data @"$RESUMEAPPLYR_TEMP/<key>-letter.json" --out "$RESUMEAPPLYR_TEMP/<key>-letter.pdf"`,
  upload that file.
- **How did you hear about us?** → "Job board" or "Company website".
- **Years of experience** → from the earliest experience date on the CV.
- **Relocation** → `user.willingToRelocate`; empty `preferredLocations` or one containing
  "Anywhere" means open to any location.
- **Work authorization / visa** → `user.authorizedToWorkIn` (countries), `requiresSponsorship`,
  `visaStatus`. "Are you authorized to work in <country>?" → yes only if that country is listed.
  Answer sponsorship questions truthfully from `requiresSponsorship` - never misstate one to pass a
  screen.
- **EEO / diversity** → `user.eeoGender`, `eeoRace`, `eeoEthnicity`, `eeoHispanicOrLatino`,
  `eeoVeteranStatus`, `eeoDisabilityStatus`; "Prefer not to disclose" when that's the value.
- **References** → `user.references[]` in order. If the form requires references and there are
  none, fill what you can and note it. Never invent one.
- **Other questions** → a saved answer (`GET /api/answers`) when one fits; else best judgment from
  the CV and profile; else ask the user (`./asking-the-user.md`) with an `answerKey` when the answer
  would fit other forms.

## Multi-page forms

1. After filling a page, find Next / Continue / Save & Continue and click it.
2. Repeat on each new page.
3. Re-snapshot the form to confirm the values landed before moving on.
