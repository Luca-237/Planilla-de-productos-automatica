// =====================================================================
//  Se corre UNA vez, en tu PC, para darle permiso al backup de subir
//  archivos a TU Google Drive. Imprime el GOOGLE_REFRESH_TOKEN que hay
//  que guardar como secreto en GitHub (no lo pegues en ningún chat ni archivo).
//
//    GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node backup/obtener-token-google.mjs
//
//  Permiso que pide: "drive.file" (solo ve y modifica lo que crea esta app,
//  no el resto de tu Drive).
// =====================================================================
import http from "node:http";

const id = process.env.GOOGLE_CLIENT_ID, secreto = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secreto) { console.error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET."); process.exit(1); }

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const code = url.searchParams.get("code");
  if (!code) { res.end("Esperando el permiso de Google…"); return; }
  const puerto = servidor.address().port;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secreto, redirect_uri: `http://127.0.0.1:${puerto}`, grant_type: "authorization_code" }),
  });
  const d = await r.json();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (d.refresh_token) {
    res.end("Listo. Volvé a la terminal: ahí está el GOOGLE_REFRESH_TOKEN. Ya podés cerrar esta pestaña.");
    console.log("\nGOOGLE_REFRESH_TOKEN (guardalo solo como secreto en GitHub):\n" + d.refresh_token + "\n");
  } else {
    res.end("Google no devolvió el token. Mirá la terminal.");
    console.error("Respuesta de Google:", d.error_description || d.error || JSON.stringify(d), "\nSi dice que ya se había dado permiso, quitá el acceso de esta app en https://myaccount.google.com/permissions y repetí.");
  }
  servidor.close();
});
servidor.listen(0, "127.0.0.1", () => {
  const puerto = servidor.address().port;
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: id, redirect_uri: `http://127.0.0.1:${puerto}`, response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent",
  });
  console.log("Abrí este link en el navegador, iniciá sesión con la cuenta dueña del Drive y aceptá:\n\n" + url + "\n");
});
