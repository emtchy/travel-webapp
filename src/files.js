/**
 * Attachments: the PDF ticket or the confirmation on a booking, or on one of
 * your own entries. The bytes live in R2 (the FILES binding), one object per
 * file under t/<trip>/; the row in `attachments` says what it is and where.
 *
 * Members only, always — even on a public trip, since a confirmation carries
 * names and references. Editors add and remove; when the place, the entry or
 * the trip goes, its files go with it.
 */
import { json, bad } from "./http.js";

export const MAX_BYTES = 10 * 1024 * 1024;   // per file
export const MAX_PER_TARGET = 10;

/** What may be attached, and the extension its object gets. */
export const TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const rowOf = (r) => ({
  id: r.id, target: r.target, name: r.name, type: r.type, size: r.size,
  addedBy: r.added_by, createdAt: r.created_at,
});

export async function listAttachments(env, trip) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM attachments WHERE trip_id = ?1 ORDER BY created_at ASC"
  ).bind(trip).all();
  return results.map(rowOf);
}

/** A file name fit to keep: no path, no control characters, not too long. */
function cleanName(raw, ext) {
  let name = "";
  try { name = decodeURIComponent(raw ?? ""); } catch { name = raw ?? ""; }
  name = name.split(/[\\/]/).pop().trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ");
  if (!name) name = `file.${ext}`;
  if (name.length > 120) name = name.slice(0, 116) + "…" + name.slice(-3);
  return name;
}

const notSetUp = () => bad("File storage isn't set up on this server.", 503);

/**
 * POST /api/t/<trip>/attachments/add?target=<id>
 * The file is the body; its type is the content-type header and its name the
 * x-file-name header (URI-encoded). Editors, on a place or an own entry.
 */
export async function handleAttachmentAdd(request, env, trip, ctx) {
  const { name: who, error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;
  if (!env.FILES) return notSetUp();

  const url = new URL(request.url);
  const target = url.searchParams.get("target") ?? "";
  if (!target || !(await ctx.isTarget(env, target, trip))) return bad("Attach it to a place or an entry on this trip.");

  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return bad("A PDF or a photo (JPEG, PNG, WebP, HEIC).", 415);

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BYTES) return bad("Files can be up to 10 MB.", 413);

  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE trip_id = ?1 AND target = ?2")
    .bind(trip, target).first("n");
  if (n >= MAX_PER_TARGET) return bad(`Up to ${MAX_PER_TARGET} files on one thing.`);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return bad("That file is empty.");
  if (bytes.byteLength > MAX_BYTES) return bad("Files can be up to 10 MB.", 413);

  const id = `f-${crypto.randomUUID()}`;
  const key = `t/${trip}/${id}.${ext}`;
  const fileName = cleanName(request.headers.get("x-file-name"), ext);
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare(
    `INSERT INTO attachments (id, trip_id, target, name, type, size, key, added_by, added_by_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(id, trip, target, fileName, type, bytes.byteLength, key, who, ctx.voterKey(who), Date.now()).run();

  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}

/** POST /api/t/<trip>/attachments/remove  { id } — editors. */
export async function handleAttachmentRemove(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;
  const id = typeof body?.id === "string" ? body.id : "";
  const row = await env.DB.prepare("SELECT key FROM attachments WHERE id = ?1 AND trip_id = ?2").bind(id, trip).first();
  if (!row) return bad("That file is already gone.", 404);
  if (env.FILES) await env.FILES.delete(row.key);
  await env.DB.prepare("DELETE FROM attachments WHERE id = ?1 AND trip_id = ?2").bind(id, trip).run();
  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}

/**
 * GET /api/t/<trip>/attachments/<id> — the file itself, for members. Served
 * inline with its own name, so a PDF opens in the browser and saves under
 * the name it was uploaded with. Kept private: a ticket is not a photo.
 */
export async function handleAttachmentGet(request, env, trip, id, ctx) {
  const { error } = await ctx.actor(request, env, trip);
  if (error) return error;
  if (!env.FILES) return notSetUp();
  const row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?1 AND trip_id = ?2").bind(id, trip).first();
  if (!row) return bad("No such file.", 404);
  const obj = await env.FILES.get(row.key);
  if (!obj) return bad("The file is missing from storage.", 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": row.type,
      "content-length": String(row.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, max-age=0",
    },
  });
}

/** Everything attached to one place or entry goes — bytes and rows. */
export async function removeAttachmentsFor(env, trip, target) {
  const { results } = await env.DB.prepare("SELECT key FROM attachments WHERE trip_id = ?1 AND target = ?2")
    .bind(trip, target).all();
  if (results.length && env.FILES) await env.FILES.delete(results.map((r) => r.key));
  await env.DB.prepare("DELETE FROM attachments WHERE trip_id = ?1 AND target = ?2").bind(trip, target).run();
}

/** Everything under a trip goes — the bucket prefix and the rows. */
export async function removeTripAttachments(env, trip) {
  if (env.FILES) {
    let cursor;
    do {
      const page = await env.FILES.list({ prefix: `t/${trip}/`, cursor });
      if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await env.DB.prepare("DELETE FROM attachments WHERE trip_id = ?1").bind(trip).run();
}
