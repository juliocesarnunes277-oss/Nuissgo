const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/api/config" && request.method === "GET")
      return json({ googleClientId: env.GOOGLE_CLIENT_ID || "" });

    if (url.pathname === "/api/auth/google" && request.method === "POST") {
      try {
        const { credential } = await request.json();
        if (!credential || !env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET)
          return json({ error: "Login Google não configurado no servidor." }, 503);

        // Validate the Google-issued ID token with Google's tokeninfo endpoint.
        const verify = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
        const info = await verify.json();
        if (!verify.ok || info.aud !== env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(info.iss) || Number(info.exp) * 1000 < Date.now() || info.email_verified !== "true")
          return json({ error: "Não foi possível validar essa conta Google." }, 401);

        const email = String(info.email || "").toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
          return json({ error: "A conta Google não retornou um e-mail válido." }, 401);

        const session = await createSession({ email, name: info.name || email, exp: Math.floor(Date.now()/1000) + 60*60*24*7 }, env.SESSION_SECRET);
        return json({ user: { email, name: info.name || email, isAdmin: email === String(env.ADMIN_EMAIL || "").toLowerCase() } }, 200, {
          "Set-Cookie": `ng_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
        });
      } catch (e) {
        return json({ error: "Falha ao autenticar com Google." }, 500);
      }
    }

    if (url.pathname === "/api/logout" && request.method === "POST")
      return json({ ok: true }, 200, { "Set-Cookie": "ng_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });

    if (url.pathname === "/api/me" && request.method === "GET") {
      const user = await getSession(request, env);
      return json({ user: user ? { email: user.email, name: user.name, isAdmin: user.email === String(env.ADMIN_EMAIL || "").toLowerCase() } : null });
    }

    // Published pages are public, while management APIs require a Google session.
    if (url.pathname.startsWith("/s/") && request.method === "GET") {
      const slug = url.pathname.slice(3).toLowerCase();
      if (!/^[a-z0-9-]{2,60}$/.test(slug)) return new Response("Endereço inválido", { status: 400 });
      const row = await env.DB.prepare("SELECT html FROM sites WHERE slug = ?").bind(slug).first();
      if (!row) return new Response("Site não encontrado", { status: 404 });
      return new Response(row.html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=60" } });
    }

    if (url.pathname === "/api/sites" && request.method === "GET") {
      const user = await getSession(request, env);
      if (!user) return json({ error: "Entre com Google para ver seus sites." }, 401);
      const admin = user.email === String(env.ADMIN_EMAIL || "").toLowerCase();
      const query = admin
        ? env.DB.prepare("SELECT name, slug, owner_email, created_at FROM sites ORDER BY created_at DESC LIMIT 100")
        : env.DB.prepare("SELECT name, slug, owner_email, created_at FROM sites WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100").bind(user.email);
      const { results } = await query.all();
      return json({ sites: (results || []).map(s => ({ name: s.name, slug: s.slug, ownerEmail: s.owner_email, url: `${url.origin}/s/${s.slug}`, created_at: s.created_at })) });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      const user = await getSession(request, env);
      if (!user) return json({ error: "Entre com a conta Google que será proprietária deste site." }, 401);
      if (!env.GEMINI_API_KEY) return json({ error: "Configure GEMINI_API_KEY como secret no servidor." }, 503);
      try {
        const data = await request.json();
        if (typeof data.business !== "string" || !data.business.trim() || typeof data.description !== "string" || !data.description.trim())
          return json({ error: "Informe o nome e a descrição da empresa." }, 400);

        const clean = {
          business: data.business.slice(0, 70),
          type: String(data.type || "Empresa").slice(0, 80),
          color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#3478f6",
          description: data.description.slice(0, 1200),
          items: String(data.items || "").slice(0, 1500),
          whatsapp: String(data.whatsapp || "").replace(/\D/g, "").slice(0, 15),
          instagram: String(data.instagram || "").slice(0, 80),
          photos: Array.isArray(data.photos) ? data.photos.filter(x => typeof x === "string" && /^https:\/\/images\.unsplash\.com\//i.test(x)).slice(0, 8) : []
        };
        const prompt = `Crie um site profissional completo e responsivo para a empresa descrita. Responda somente com HTML completo, sem Markdown.

Empresa: ${clean.business}
Segmento: ${clean.type}
Descrição: ${clean.description}
Produtos/serviços e preços: ${clean.items || "Não informado"}
WhatsApp: ${clean.whatsapp || "Não informado"}
Instagram: ${clean.instagram || "Não informado"}
Cor: ${clean.color}
Fotos fornecidas: ${clean.photos.join("\n") || "Nenhuma"}

Requisitos: português brasileiro; HTML semântico; CSS e JavaScript no próprio documento; visual premium e adaptado ao segmento; mobile-first; acessibilidade e SEO; hero, apresentação, catálogo/serviços com os preços informados, diferenciais, galeria, FAQ e rodapé; adaptar seções para restaurante, clínica, loja, curso etc.; usar imagens coerentes; não inventar avaliações, endereço, CNPJ, certificações, horários, preços ou fatos; não criar checkout/formulário falso; WhatsApp apenas se fornecido; Instagram apenas se fornecido; sem bibliotecas obrigatórias, rastreadores ou links falsos; código limpo pronto para abrir. Retorne somente HTML.`;

        const model = env.GEMINI_MODEL || "gemini-2.5-flash";
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
        const upstream = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, maxOutputTokens: 12000 } })
        });
        const result = await upstream.json();
        if (!upstream.ok) return json({ error: result?.error?.message || "Falha no serviço de IA." }, upstream.status === 429 ? 429 : 502);
        let generated = result?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
        generated = generated.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();
        if (!generated.toLowerCase().includes("<html") || generated.length < 500)
          return json({ error: "A IA retornou uma página incompleta. Tente novamente." }, 502);

        const slugBase = slugify(clean.business);
        let slug = slugBase, suffix = 2;
        while (await env.DB.prepare("SELECT slug FROM sites WHERE slug = ?").bind(slug).first()) {
          slug = `${slugBase}-${suffix++}`;
          if (suffix > 1000) throw new Error("Falha ao reservar endereço único.");
        }
        await env.DB.prepare("INSERT INTO sites (slug, name, html, owner_email, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
          .bind(slug, clean.business, generated, user.email).run();
        return json({ html: generated, slug, url: `${url.origin}/s/${slug}`, ownerEmail: user.email });
      } catch (e) {
        return json({ error: "Não foi possível gerar/publicar o site. Confira o banco D1 e tente novamente." }, 500);
      }
    }

    // Admin-only ownership transfer endpoint. Add a confirmation UI before exposing it to customers.
    if (url.pathname === "/api/admin/transfer" && request.method === "POST") {
      const user = await getSession(request, env);
      if (!user || user.email !== String(env.ADMIN_EMAIL || "").toLowerCase())
        return json({ error: "Apenas o administrador principal pode transferir propriedade." }, 403);
      const body = await request.json();
      const slug = String(body.slug || "");
      const newOwner = String(body.newOwnerEmail || "").toLowerCase().trim();
      if (!/^[a-z0-9-]{2,60}$/.test(slug) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newOwner))
        return json({ error: "Informe o endereço do site e um Gmail válido." }, 400);
      const result = await env.DB.prepare("UPDATE sites SET owner_email = ? WHERE slug = ?").bind(newOwner, slug).run();
      return json({ ok: result.meta?.changes > 0 });
    }

    return env.ASSETS.fetch(request);
  }
};

async function createSession(payload, secret) {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const signature = btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${body}.${signature}`;
}
async function getSession(request, env) {
  try {
    if (!env.SESSION_SECRET) return null;
    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)ng_session=([^;]+)/);
    if (!match) return null;
    const [body, signature] = match[1].split(".");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
    if (!valid) return null;
    const payload = JSON.parse(decodeURIComponent(escape(atob(body.replace(/-/g, "+").replace(/_/g, "/")))));
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch (e) { return null; }
}
function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "site";
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, ...extra, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
