// Script de un solo uso: borra el marcador de bootstrap para forzar que se
// vuelva a importar AUTH_INFO_B64 (usado tras una corrupción de sesión / Bad
// MAC, cuando se sube una sesión nueva). Se llama desde railway.toml antes de
// arrancar el bot. No falla si el archivo no existe.
try {
  require('fs').unlinkSync('auth_info/.bootstrapped_from_env');
  console.log('🧹 Marcador de bootstrap borrado, se re-importará AUTH_INFO_B64.');
} catch (e) {
  console.log('🧹 No había marcador de bootstrap que borrar.');
}
