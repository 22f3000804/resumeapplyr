// A stand-in for Cloudflare D1 that understands the one statement the signup function runs.
export function createFakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (!/^INSERT INTO signups/i.test(sql)) throw new Error(`unexpected SQL: ${sql}`);
              const [email, source] = params;
              if (!rows.has(email)) rows.set(email, { email, source, created_at: new Date().toISOString() });
              return { success: true };
            }
          };
        }
      };
    }
  };
}
