import { z } from "zod";
import { badRequest, notFound } from "../../core/errors";
import type { ServiceContext } from "./context";
import type { Board } from "../../shared/types";
export type { Board };


/** Boards offered out of the box. Users can add any other site by domain. */
const DEFAULT_BOARDS: Omit<Board, "builtin">[] = [
  { domain: "linkedin.com", name: "LinkedIn", searchUrl: "https://www.linkedin.com/jobs/search/" },
  { domain: "indeed.com", name: "Indeed (US)", searchUrl: "https://www.indeed.com/" },
  { domain: "uk.indeed.com", name: "Indeed (UK)", searchUrl: "https://uk.indeed.com/" },
  { domain: "in.indeed.com", name: "Indeed (India)", searchUrl: "https://in.indeed.com/" },
  { domain: "naukri.com", name: "Naukri", searchUrl: "https://www.naukri.com/" },
  { domain: "glassdoor.com", name: "Glassdoor", searchUrl: "https://www.glassdoor.com/Job/index.htm" },
  { domain: "hiring.cafe", name: "Hiring Cafe", searchUrl: "https://hiring.cafe/" },
  { domain: "wellfound.com", name: "Wellfound", searchUrl: "https://wellfound.com/jobs" },
  {
    domain: "welcometothejungle.com",
    name: "Welcome to the Jungle",
    searchUrl: "https://www.welcometothejungle.com/en/jobs",
  },
  { domain: "weworkremotely.com", name: "We Work Remotely", searchUrl: "https://weworkremotely.com/" },
];

const boardInputSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .refine((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d), "Enter a domain like jobs.example.com"),
  name: z.string().trim().min(1).max(80),
  searchUrl: z.url().optional().nullable(),
});

interface BoardRow {
  domain: string;
  name: string;
  search_url: string | null;
  builtin: number;
}

export class BoardService {
  constructor(private readonly ctx: ServiceContext) {
    DEFAULT_BOARDS.forEach((board, index) =>
      ctx.db.run(
        "INSERT OR IGNORE INTO boards (domain, name, search_url, builtin, sort_order) VALUES (?, ?, ?, 1, ?)",
        board.domain,
        board.name,
        board.searchUrl,
        index,
      ),
    );
  }

  list(): Board[] {
    return this.ctx.db
      .all<BoardRow>("SELECT * FROM boards ORDER BY sort_order, name")
      .map((r) => ({ domain: r.domain, name: r.name, searchUrl: r.search_url, builtin: r.builtin === 1 }));
  }

  find(domain: string): Board | undefined {
    return this.list().find((b) => b.domain === domain.toLowerCase());
  }

  add(input: unknown): Board {
    const board = boardInputSchema.parse(input);
    this.ctx.db.run(
      "INSERT INTO boards (domain, name, search_url, builtin, sort_order) VALUES (?, ?, ?, 0, 1000) ON CONFLICT(domain) DO UPDATE SET name = excluded.name, search_url = excluded.search_url",
      board.domain,
      board.name,
      board.searchUrl ?? null,
    );
    this.ctx.events.changed("boards");
    return this.find(board.domain)!;
  }

  remove(domain: string): void {
    const board = this.find(domain);
    if (!board) throw notFound("Board not found");
    if (board.builtin) throw badRequest("Built-in boards can't be removed.");
    this.ctx.db.run("DELETE FROM boards WHERE domain = ?", board.domain);
    this.ctx.events.changed("boards");
  }
}
