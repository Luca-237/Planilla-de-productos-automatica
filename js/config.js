// =====================================================================
//  Conexión con Supabase. Estos dos valores son PÚBLICOS (van en el
//  navegador de todos modos): lo que protege los datos son los permisos
//  de la base (RLS). La clave "secret"/"service_role" NUNCA va acá.
//  Paso a paso en SUPABASE-SETUP.md.
// =====================================================================
window.COMPRAS_CONFIG = {
  supabaseUrl: "https://bghjltwkkxnxjypuuvnu.supabase.co",
  supabaseKey: "sb_publishable_m1ynuJ4ZVIvsYf5fpl0aMw_800yQi8i",   // clave "publishable"
  // "antonella" -> "antonella@compras.cindymayorista.com.ar" (no hace falta que el email exista)
  dominioUsuarios: "compras.cindymayorista.com.ar",
  // Nombre con el que quedó publicada la Edge Function de usuarios
  funcionUsuarios: "admin-usuarios",
  // A partir de cuántos días sin llegar una línea se marca en rojo
  diasAlerta: 15,
};
