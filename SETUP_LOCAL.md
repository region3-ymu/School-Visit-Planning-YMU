# Configuración Local con Base de Datos Compartida

## Opción 1: Usar Neon (Ya configurado)

1. **Variables de Entorno Locales:**
   ```bash
   # Copia tu DATABASE_URL de Neon
   DATABASE_URL="postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require"
   ```

2. **Ejecutar Localmente:**
   ```bash
   npm run dev
   ```

3. **Acceder desde otros PCs:**
   - Tu PC: `http://localhost:3000`
   - Otros PCs: `http://TU_IP_LOCAL:3000`

## Opción 2: Supabase (Recomendado)

1. **Crear cuenta en https://supabase.com**
2. **Crear nuevo proyecto**
3. **Obtener DATABASE_URL**
4. **Ejecutar migración:**
   ```bash
   npx prisma db push
   ```

## Opción 3: Configurar Acceso Remoto

1. **Hacer tu PC accesible:**
   ```bash
   npm run dev -- --host 0.0.0.0
   ```

2. **Acceder desde otros dispositivos:**
   `http://TU_IP_PUBLICA:3000`

## Ventajas de esta solución:

✅ **Base de datos centralizada** (Neon/Supabase)
✅ **Accesible desde cualquier PC**
✅ **Datos persistentes**
✅ **No depende de Vercel**
✅ **Control total**
✅ **Offline development posible**

## Pasos para empezar:

1. Elige tu opción de base de datos
2. Configura DATABASE_URL en .env.local
3. Ejecuta `npm run dev`
4. Accede desde cualquier PC con tu IP
