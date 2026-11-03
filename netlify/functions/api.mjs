import { getDatabase } from "@netlify/database";
import XLSX from "xlsx";
import { randomInt, createHash, timingSafeEqual } from "node:crypto";

const json = (o, s = 200) => Response.json(o, { status: s, headers: { "cache-control": "no-store" } });
const hash = (s) => createHash("sha256").update(String(s)).digest();
const isAdmin = (req) => {
  const p = process.env.ADMIN_PASSWORD;
  return !!p && timingSafeEqual(hash(p), hash(req.headers.get("x-admin-password") || ""));
};
const TZ = process.env.EXPORT_TZ || "Asia/Jerusalem";
const fmtD = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const fmtT = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, timeStyle: "medium" }).format(d);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0.0") + "%";

export default async (req) => {
  const db = getDatabase();
  const sql = db.sql;
  const url = new URL(req.url);
  const [a, b, c] = url.pathname.replace(/^\/api\//, "").split("/");
  const body = req.method === "POST" || req.method === "PUT" ? await req.json().catch(() => ({})) : {};
  try {
    if (a === "pics" && req.method === "GET") {
      return json(await sql`SELECT n, title, extract(epoch from updated_at)::int AS v FROM pictures ORDER BY n`);
    }
    if (a === "pic" && req.method === "GET") {
      const n = parseInt(b, 10);
      const { rows } = await db.pool.query("SELECT mime, data FROM pictures WHERE n=$1", [n]);
      if (rows[0]?.data) {
        return new Response(rows[0].data, { headers: { "content-type": rows[0].mime, "cache-control": "public, max-age=86400" } });
      }
      return Response.redirect(new URL(`/pics/pic${n}.jpg`, req.url), 302);
    }
    if (a === "check" && req.method === "POST") {
      if (!/^\d{6}$/.test(body.code || "")) return json({ status: "invalid" });
      const r = await sql`SELECT used_at FROM codes WHERE code = ${body.code}`;
      return json({ status: !r.length ? "invalid" : r[0].used_at ? "used" : "ok" });
    }
    if (a === "vote" && req.method === "POST") {
      const pic = parseInt(body.picture, 10);
      if (!/^\d{6}$/.test(body.code || "") || ![1, 2, 3].includes(pic)) return json({ status: "invalid" }, 400);
      const r = await sql`UPDATE codes SET picture = ${pic}, used_at = now()
                          WHERE code = ${body.code} AND used_at IS NULL RETURNING code`;
      if (r.length) return json({ status: "ok" });
      const e = await sql`SELECT 1 FROM codes WHERE code = ${body.code}`;
      return json({ status: e.length ? "used" : "invalid" }, e.length ? 409 : 404);
    }
    if (a === "admin") {
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
      if (b === "classes" && req.method === "GET") {
        return json(await sql`SELECT c.id, c.name, count(k.code)::int AS total, count(k.used_at)::int AS used
                              FROM classes c LEFT JOIN codes k ON k.class_id = c.id GROUP BY c.id ORDER BY c.name`);
      }
      if (b === "stats") {
        const cid = parseInt(url.searchParams.get("class"), 10);
        const f = Number.isInteger(cid) ? cid : null;
        const t = await sql`SELECT count(*)::int AS total, count(used_at)::int AS used FROM codes WHERE (${f}::int IS NULL OR class_id = ${f}::int)`;
        const p = await sql`SELECT picture, count(*)::int AS n FROM codes WHERE picture IS NOT NULL AND (${f}::int IS NULL OR class_id = ${f}::int) GROUP BY picture`;
        const votes = { 1: 0, 2: 0, 3: 0 };
        p.forEach((r) => (votes[r.picture] = r.n));
        return json({ total: t[0].total, used: t[0].used, votes });
      }
      if (b === "generate" && req.method === "POST") {
        const name = String(body.name || "").trim().slice(0, 60);
        const count = parseInt(body.count, 10);
        if (!name || !(count >= 1 && count <= 1000)) return json({ error: "Enter a class name and a number of codes between 1 and 1000." }, 400);
        const cl = await db.pool.query("INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [name]);
        const classId = cl.rows[0].id;
        const existing = new Set((await db.pool.query("SELECT code FROM codes")).rows.map((r) => r.code.trim()));
        const fresh = new Set();
        while (fresh.size < count) {
          const c = String(randomInt(0, 1000000)).padStart(6, "0");
          if (!existing.has(c)) fresh.add(c);
        }
        await db.pool.query("INSERT INTO codes (code, class_id) SELECT unnest($1::text[]), $2", [[...fresh], classId]);
        return json({ ok: true, added: count });
      }
      if (b === "codes") return json(await sql`SELECT k.code, k.picture, k.used_at, c.name AS class FROM codes k LEFT JOIN classes c ON c.id = k.class_id ORDER BY c.name, k.code`);
      if (b === "pic" && req.method === "PUT") {
        const n = parseInt(c, 10);
        let mime = null, data = null;
        const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image || "");
        if (m) { mime = m[1]; data = Buffer.from(m[2], "base64"); }
        await db.pool.query(
          "UPDATE pictures SET title=$1, mime=COALESCE($2,mime), data=COALESCE($3,data), updated_at=now() WHERE n=$4",
          [String(body.title || "").slice(0, 120), mime, data, n]);
        return json({ ok: true });
      }
      if (b === "export") {
        const rows = await sql`SELECT k.code, k.picture, k.used_at, coalesce(c.name, '-') AS class
                               FROM codes k LEFT JOIN classes c ON c.id = k.class_id ORDER BY c.name, k.code`;
        const wb = XLSX.utils.book_new();
        if (url.searchParams.get("type") === "codes") {
          const aoa = [["Class", "Voting Code", "Status"], ...rows.map((r) => [r.class, r.code, r.used_at ? "Used" : "Unused"])];
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Codes");
        } else {
          const aoa = [["Class", "Voter Code", "Selected Picture", "Vote Date", "Vote Time", "Vote Status"]];
          const per = {};
          const tally = (k) => (per[k] ||= { total: 0, 1: 0, 2: 0, 3: 0 });
          const all = { total: 0, 1: 0, 2: 0, 3: 0 };
          for (const r of rows) {
            const t = tally(r.class);
            t.total++; all.total++;
            if (r.used_at) {
              t[r.picture]++; all[r.picture]++;
              aoa.push([r.class, r.code, `Picture ${r.picture}`, fmtD(r.used_at), fmtT(r.used_at), "Voted"]);
            } else aoa.push([r.class, r.code, "", "", "", "Not voted"]);
          }
          const line = (label, t) => {
            const v = t[1] + t[2] + t[3];
            return [label, t.total, v, t.total - v, pct(v, t.total), t[1], t[2], t[3], pct(t[1], v), pct(t[2], v), pct(t[3], v)];
          };
          const sum = [["Class", "Total codes", "Votes", "Unused", "Participation", "Picture 1", "Picture 2", "Picture 3", "% Picture 1", "% Picture 2", "% Picture 3"],
            ...Object.keys(per).sort().map((k) => line(k, per[k])), line("ALL CLASSES", all), [], ["Times shown in", TZ]];
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Votes");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
        }
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        return new Response(buf, { headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="export.xlsx"', "cache-control": "no-store" } });
      }
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
};
export const config = { path: "/api/*" };
