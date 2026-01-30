# Integración con Atlas Console - Guía para Portal Tercero 🚀

## 📋 Resumen

Tu portal recibirá un **JWT (JSON Web Token)** desde Atlas Console que contiene la información del partner autenticado. Este token te permite implementar **Single Sign-On (SSO)** y hacer requests autenticados a nuestra API.

**Flujo:**
```
1. Usuario autenticado abre tu portal desde Console
2. Console envía JWT via postMessage
3. Tu portal guarda el JWT
4. Usas el JWT para hacer requests autenticados a Atlas Console API
```

⚠️ **IMPORTANTE:** 
- El JWT debe tratarse como **opaco** (no decodificarlo en cliente)
- Solo es válido para hacer requests **autenticados** a nuestra API
- Expira en **24 horas**

---

## ⚡ Implementación (3 pasos)

### 1️⃣ Recibir JWT via postMessage

Atlas Console abrirá tu portal en una nueva ventana y enviará el token via `postMessage`.

```javascript
// En tu aplicación (app.js, main.js, o index.html)
window.addEventListener('message', (event) => {
  // ⚠️ CRÍTICO: Validar origen
  if (event.origin !== 'https://dashboard-lab.pijamafilms.com') {
    console.warn('❌ Origen no confiable:', event.origin);
    return;
  }
  
  if (event.data.type === 'ATLAS_AUTH') {
    const jwt = event.data.token;
    console.log('✅ Token recibido de Atlas Console');
    
    // Guardar y continuar
    processToken(jwt);
  }
});
```

### 2️⃣ Guardar JWT para requests autenticados

**El JWT debe tratarse como opaco** - No lo decodifiques en el cliente. Solo guárdalo para usarlo en requests:

```javascript
function processToken(jwt) {
  try {
    // Guardar JWT en sessionStorage
    sessionStorage.setItem('atlasToken', jwt);
    
    console.log('✅ Token recibido y guardado');
    
    // Inicializar tu aplicación
    initializeApp();
    
  } catch (error) {
    console.error('❌ Error procesando token:', error);
    redirectToConsole();
  }
}

function redirectToConsole() {
  alert('Sesión inválida. Redirigiendo a Console...');
  window.location.href = 'https://dashboard-lab.pijamafilms.com';
}
```

### 3️⃣ Obtener películas del partner

Usa el JWT para hacer requests autenticados. El servidor validará el token y devolverá los datos:

```javascript
async function loadPartnerMovies(jwt) {
  try {
    // Request al endpoint de Atlas Console (requiere autenticación)
    const response = await fetch('https://dashboard-lab.pijamafilms.com/movies/by-partner', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`  // ⚠️ REQUERIDO: JWT en header
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Token inválido o faltante');
      }
      if (response.status === 403) {
        throw new Error('Token expirado');
      }
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.status === 'ok') {
      const movies = result.data.movies;      // Array de películas
      const partnerInfo = result.data.partner; // Info del partner
      
      console.log(`✅ ${movies.length} películas encontradas`);
      console.log(`👤 Partner: ${partnerInfo.name}`);
      
      // Guardar info del partner (opcional)
      sessionStorage.setItem('partnerInfo', JSON.stringify(partnerInfo));
      
      // Renderizar películas en tu UI
      renderMovies(movies);
      return { movies, partnerInfo };
      
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error('❌ Error obteniendo películas:', error);
    
    // Si el token expiró, redirigir a Console
    if (error.message.includes('expirado') || error.message.includes('401') || error.message.includes('403')) {
      alert('Tu sesión ha expirado. Redirigiendo a Console...');
      redirectToConsole();
    }
    
    showError('No se pudieron cargar las películas: ' + error.message);
    return { movies: [], partnerInfo: null };
  }
}

// Ejemplo de uso
async function initializeApp() {
  // Recuperar JWT del sessionStorage
  const jwt = sessionStorage.getItem('atlasToken');
  
  if (!jwt) {
    console.error('❌ No hay token disponible');
    redirectToConsole();
    return;
  }
  
  // Cargar películas del partner (el JWT identifica al partner)
  const { movies, partnerInfo } = await loadPartnerMovies(jwt);
  
  if (partnerInfo) {
    console.log(`👋 Bienvenido ${partnerInfo.name}`);
    console.log(`📧 Email: ${partnerInfo.email}`);
    console.log(`🆔 Muvi UUID: ${partnerInfo.muviUuid}`);
  }
  
  if (movies.length > 0) {
    console.log('Primera película:', movies[0].title);
  }
}
```

**Estructura de la respuesta:**

```json
{
  "status": "ok",
  "data": {
    "partner": {
      "name": "John Doe",
      "email": "partner@example.com",
      "muviUuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "partnerId": "507f1f77bcf86cd799439011"
    },
    "movies": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "title": "Nombre de la Película",
        "description": "Descripción completa...",
        "genre": ["Drama", "Thriller"],
        "duration": 120,
        "releaseYear": 2024,
        "muviUuid": "uuid-de-contenido-en-muvi",
        "status": "published",
        "assets": [...],
        "createdAt": "2025-12-15T10:30:00.000Z"
      }
    ]
  }
}
```

---

## 📦 Seguridad del JWT

⚠️ **IMPORTANTE:** El JWT debe tratarse como **opaco** en el cliente. No lo decodifiques ni extraigas información de él.

**Características de seguridad:**
- ✅ Firmado con **HS256** (HMAC-SHA256)
- ✅ Expira en **24 horas**
- ✅ Solo válido para requests autenticados
- ✅ Validado en servidor con secret key
- ❌ **NO decodificar en el cliente** (inseguro)

El servidor valida el JWT automáticamente.

---

## ✅ Checklist de Implementación

### Código Requerido

- [ ] Listener de `postMessage` implementado
- [ ] Validación de `event.origin === 'https://dashboard-lab.pijamafilms.com'`
- [ ] Guardar JWT en `sessionStorage` (NO decodificarlo)
- [ ] Request a `/movies/by-partner` incluye header `Authorization: Bearer <jwt>`
- [ ] Manejar errores 401/403 (token inválido/expirado) → redirigir a Console

### Testing

- [ ] Probar recepción de postMessage desde Console
- [ ] Verificar que JWT se guarda en sessionStorage
- [ ] Confirmar que request incluye header Authorization
- [ ] Validar que respuesta incluye películas y datos del partner

---

## 🐛 Debugging

### Verificar que el JWT está guardado

```javascript
const token = sessionStorage.getItem('atlasToken');
if (token) {
  console.log('✅ JWT guardado:', token.substring(0, 30) + '...');
}
```

### Errores Comunes

| Error | Causa | Solución |
|-------|-------|----------|
| No recibe postMessage | Listener no activo | Verificar que el listener esté antes de que Console envíe |
| 401 MISSING_TOKEN | Header no enviado | Verificar `Authorization: Bearer ${jwt}` |
| 403 TOKEN_EXPIRED | Token expirado (>24h) | Redirigir a Console para nuevo token |
| 403 PARTNER_DISABLED | Partner deshabilitado | Contactar administrador |

---

## 🔐 Seguridad

### Validación de Origen (CRÍTICO)

```javascript
// ✅ CORRECTO
if (event.origin !== 'https://dashboard-lab.pijamafilms.com') {
  return;
}
```

### Buenas Prácticas

1. **Siempre validar `event.origin`**
2. **Usar sessionStorage** (se limpia al cerrar pestaña)
3. **HTTPS obligatorio**
4. **NO decodificar JWT en cliente**
5. **Manejar expiración** (redirigir a Console)

---

**Última actualización:** Enero 8, 2026
