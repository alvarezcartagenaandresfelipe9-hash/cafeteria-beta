// ===================================================
// MOTOR SQLITE NATIVO (sql.js) - SISTEMA POS CAFETERÍA
// ===================================================

let db = null;
const DB_STORAGE_KEY = 'sqlite_aroma_cafe_db';
let mesaDispositivo = null;

// 1. Inicializar SQLite
async function initSQLite() {
    const initSqlJs = window.initSqlJs;
    const SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });

    const savedDb = localStorage.getItem(DB_STORAGE_KEY);

    if (savedDb) {
        const uInt8Array = new Uint8Array(JSON.parse(savedDb));
        db = new SQL.Database(uInt8Array);
        console.log(" Base de datos POS restaurada desde LocalStorage.");
    } else {
        db = new SQL.Database();
        crearTablasEInsertarSemilla();
        guardarBD();
        console.log(" Base de datos POS creada con éxito.");
    }
}

// 2. Persistir estado de la BD en LocalStorage
function guardarBD() {
    if (!db) return;
    const data = db.export();
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)));
}

// 3. Estructura Relacional Completa (7 Tablas)
function crearTablasEInsertarSemilla() {
    // A. Productos (con stock)
    db.run(`
        CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            precio REAL NOT NULL,
            categoria TEXT NOT NULL,
            descripcion TEXT,
            imagen TEXT,
            stock INTEGER DEFAULT 50
        );
    `);

    // B. Mesas
    db.run(`
        CREATE TABLE IF NOT EXISTS mesas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_mesa INTEGER UNIQUE NOT NULL,
            estado TEXT DEFAULT 'LIBRE'
        );
    `);

    // C. Órdenes / Comandas
    db.run(`
        CREATE TABLE IF NOT EXISTS ordenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mesa_id INTEGER NOT NULL,
            estado TEXT DEFAULT 'PENDIENTE',
            total REAL DEFAULT 0.00,
            fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mesa_id) REFERENCES mesas(id)
        );
    `);

    // D. Detalle de Orden
    db.run(`
        CREATE TABLE IF NOT EXISTS detalle_orden (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orden_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            subtotal REAL NOT NULL,
            FOREIGN KEY (orden_id) REFERENCES ordenes(id),
            FOREIGN KEY (producto_id) REFERENCES productos(id)
        );
    `);

    // E. Facturas
    db.run(`
        CREATE TABLE IF NOT EXISTS facturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orden_id INTEGER NOT NULL,
            metodo_pago TEXT NOT NULL,
            total_pagado REAL NOT NULL,
            fecha_pago DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        );
    `);

    // F. Histórico de Ventas (Auditoría)
    db.run(`
        CREATE TABLE IF NOT EXISTS ventas_registro (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            factura_id INTEGER NOT NULL,
            mesa_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            nombre_producto TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            subtotal REAL NOT NULL,
            metodo_pago TEXT NOT NULL,
            fecha_venta DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // G. Movimientos de Inventario (Kardex)
    db.run(`
        CREATE TABLE IF NOT EXISTS inventario_movimientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producto_id INTEGER NOT NULL,
            tipo_movimiento TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            stock_anterior INTEGER NOT NULL,
            stock_nuevo INTEGER NOT NULL,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Semilla inicial
    db.run(`INSERT INTO mesas (numero_mesa) VALUES (1), (2), (3), (4), (5), (6);`);

    db.run(`
        INSERT INTO productos (nombre, precio, categoria, descripcion, imagen, stock) VALUES
        ('Espresso Doble', 3.50, 'Calientes', 'Extracción concentrada con cuerpo denso.', 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?auto=format&fit=crop&w=600&q=80', 100),
        ('Cappuccino Tradicional', 4.20, 'Calientes', 'Espresso con leche cremada al vapor.', 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=600&q=80', 80),
        ('Croissant de Mantequilla', 3.80, 'Repostería', 'Hojaldre francés crujiente.', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80', 25),
        ('Iced Caramel Latte', 4.90, 'Fríos', 'Espresso frío con caramelo artesanal.', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=600&q=80', 50);
    `);
}

// ===================================================
// IDENTIFICACIÓN DEL DISPOSITIVO (TABLET / MESA)
// ===================================================

function detectarMesaDispositivo() {
    const urlParams = new URLSearchParams(window.location.search);
    const mesaURL = urlParams.get('mesa');

    if (mesaURL) {
        mesaDispositivo = Number(mesaURL);
        localStorage.setItem('dispositivo_mesa_id', mesaDispositivo);
    } else {
        const mesaGuardada = localStorage.getItem('dispositivo_mesa_id');
        if (mesaGuardada) {
            mesaDispositivo = Number(mesaGuardada);
        }
    }

    window.mesaDispositivo = mesaDispositivo;

    if (!mesaDispositivo) {
        document.getElementById('modalMesa').style.display = 'flex';
    } else {
        actualizarBadgesMesa();
    }
}

function guardarMesaDispositivo() {
    const select = document.getElementById('selectConfigMesa');
    mesaDispositivo = Number(select.value);
    localStorage.setItem('dispositivo_mesa_id', mesaDispositivo);
    window.mesaDispositivo = mesaDispositivo;

    document.getElementById('modalMesa').style.display = 'none';
    actualizarBadgesMesa();
    sincronizarIframeCarrito();
}

function solicitarCambioMesa() {
    document.getElementById('modalMesa').style.display = 'flex';
}

function actualizarBadgesMesa() {
    const lbl = document.getElementById('lblMesaActual');
    if (lbl && mesaDispositivo) {
        lbl.textContent = `Mesa ${mesaDispositivo}`;
    }
    actualizarContadorBadgeHeader();
}

// ===================================================
// LÓGICA DE NEGOCIO POS (COMANDAS, FACTURAS E INVENTARIO)
// ===================================================

function obtenerOrdenActivaMesa(mesaId) {
    let res = db.exec(`SELECT id FROM ordenes WHERE mesa_id = ${mesaId} AND estado = 'PENDIENTE'`);

    if (res.length > 0 && res[0].values.length > 0) {
        return res[0].values[0][0];
    } else {
        db.run(`INSERT INTO ordenes (mesa_id) VALUES (${mesaId})`);
        db.run(`UPDATE mesas SET estado = 'OCUPADA' WHERE id = ${mesaId}`);
        guardarBD();

        res = db.exec(`SELECT id FROM ordenes WHERE mesa_id = ${mesaId} AND estado = 'PENDIENTE'`);
        return res[0].values[0][0];
    }
}

function agregarProductoAMesa(productoId, cantidad = 1) {
    if (!mesaDispositivo) {
        solicitarCambioMesa();
        return;
    }

    const prodRes = db.exec(`SELECT nombre, precio, stock FROM productos WHERE id = ${productoId}`);
    if (prodRes.length === 0) return;

    const [nombre, precio, stock] = prodRes[0].values[0];

    if (stock < cantidad) {
        alert(`¡Stock insuficiente! Quedan ${stock} unidades de ${nombre}.`);
        return;
    }

    const ordenId = obtenerOrdenActivaMesa(mesaDispositivo);
    const subtotal = precio * cantidad;

    db.run(`
        INSERT INTO detalle_orden (orden_id, producto_id, cantidad, precio_unitario, subtotal)
        VALUES (${ordenId}, ${productoId}, ${cantidad}, ${precio}, ${subtotal});
    `);

    recalcularTotalOrden(ordenId);
}

// Incrementar cantidad (+1) desde la comanda
function incrementarCantidadDetalle(detalleId) {
    const res = db.exec(`
        SELECT d.cantidad, d.precio_unitario, d.orden_id, p.stock, p.nombre 
        FROM detalle_orden d 
        JOIN productos p ON d.producto_id = p.id 
        WHERE d.id = ${detalleId}
    `);
    
    if (res.length === 0) return;
    const [cant, precio, ordenId, stock, nombre] = res[0].values[0];

    if (stock <= cant) {
        alert(`¡Sin stock suficiente! Quedan ${stock} ud. de ${nombre}.`);
        return;
    }

    const nuevaCant = cant + 1;
    const nuevoSubtotal = nuevaCant * precio;

    db.run(`UPDATE detalle_orden SET cantidad = ${nuevaCant}, subtotal = ${nuevoSubtotal} WHERE id = ${detalleId}`);
    recalcularTotalOrden(ordenId);
}

// Decrementar cantidad (-1) desde la comanda
function decrementarCantidadDetalle(detalleId) {
    const res = db.exec(`SELECT cantidad, precio_unitario, orden_id FROM detalle_orden WHERE id = ${detalleId}`);
    if (res.length === 0) return;
    const [cant, precio, ordenId] = res[0].values[0];

    if (cant > 1) {
        const nuevaCant = cant - 1;
        const nuevoSubtotal = nuevaCant * precio;
        db.run(`UPDATE detalle_orden SET cantidad = ${nuevaCant}, subtotal = ${nuevoSubtotal} WHERE id = ${detalleId}`);
    } else {
        db.run(`DELETE FROM detalle_orden WHERE id = ${detalleId}`);
    }

    recalcularTotalOrden(ordenId);
}

// Eliminar ítem completo de la comanda
function eliminarDetalleOrden(detalleId) {
    const res = db.exec(`SELECT orden_id FROM detalle_orden WHERE id = ${detalleId}`);
    if (res.length === 0) return;
    const ordenId = res[0].values[0][0];

    db.run(`DELETE FROM detalle_orden WHERE id = ${detalleId}`);
    recalcularTotalOrden(ordenId);
}

// Recalcular total de la orden activa
function recalcularTotalOrden(ordenId) {
    const sumRes = db.exec(`SELECT SUM(subtotal) FROM detalle_orden WHERE orden_id = ${ordenId}`);
    const nuevoTotal = (sumRes.length > 0 && sumRes[0].values[0][0] !== null) ? sumRes[0].values[0][0] : 0;

    db.run(`UPDATE ordenes SET total = ${nuevoTotal} WHERE id = ${ordenId}`);
    guardarBD();
    actualizarContadorBadgeHeader();
    sincronizarIframeCarrito();
}

function obtenerComandaMesa(mesaId) {
    if (!db || !mesaId) return { items: [], total: 0 };

    const ordenRes = db.exec(`SELECT id, total FROM ordenes WHERE mesa_id = ${mesaId} AND estado = 'PENDIENTE'`);
    if (ordenRes.length === 0) return { items: [], total: 0 };

    const [ordenId, total] = ordenRes[0].values[0];

    const detallesRes = db.exec(`
        SELECT d.id, p.nombre, p.imagen, d.cantidad, d.precio_unitario, d.subtotal
        FROM detalle_orden d
        JOIN productos p ON d.producto_id = p.id
        WHERE d.orden_id = ${ordenId}
    `);

    if (detallesRes.length === 0) return { items: [], total: 0 };

    const items = detallesRes[0].values.map(row => ({
        detalleId: row[0],
        nombre: row[1],
        imagen: row[2],
        cantidad: row[3],
        precioUnitario: row[4],
        subtotal: row[5]
    }));

    return { items, total };
}

function procesarVentaMesa(metodoPago = 'EFECTIVO') {
    if (!mesaDispositivo) return;

    const ordenRes = db.exec(`SELECT id, total FROM ordenes WHERE mesa_id = ${mesaDispositivo} AND estado = 'PENDIENTE'`);
    if (ordenRes.length === 0) return alert("No hay comanda activa para esta mesa.");

    const [ordenId, total] = ordenRes[0].values[0];

    db.run(`INSERT INTO facturas (orden_id, metodo_pago, total_pagado) VALUES (${ordenId}, '${metodoPago}', ${total})`);
    const facturaId = db.exec(`SELECT last_insert_rowid()`)[0].values[0][0];

    const detalles = db.exec(`
        SELECT d.producto_id, p.nombre, d.cantidad, d.precio_unitario, d.subtotal, p.stock
        FROM detalle_orden d
        JOIN productos p ON d.producto_id = p.id
        WHERE d.orden_id = ${ordenId}
    `)[0].values;

    detalles.forEach(([prodId, nombreProd, cant, precioUnit, subtotal, stockActual]) => {
        db.run(`
            INSERT INTO ventas_registro (factura_id, mesa_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, metodo_pago)
            VALUES (${facturaId}, ${mesaDispositivo}, ${prodId}, '${nombreProd}', ${cant}, ${precioUnit}, ${subtotal}, '${metodoPago}');
        `);

        const nuevoStock = stockActual - cant;
        db.run(`UPDATE productos SET stock = ${nuevoStock} WHERE id = ${prodId}`);

        db.run(`
            INSERT INTO inventario_movimientos (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo)
            VALUES (${prodId}, 'VENTA', ${cant}, ${stockActual}, ${nuevoStock});
        `);
    });

    db.run(`UPDATE ordenes SET estado = 'PAGADA' WHERE id = ${ordenId}`);
    db.run(`UPDATE mesas SET estado = 'LIBRE' WHERE id = ${mesaDispositivo}`);

    guardarBD();
    renderizarProductosUI();
    actualizarContadorBadgeHeader();
    sincronizarIframeCarrito();

    alert(`¡Venta Procesada! Factura #${facturaId} registrada exitosamente.`);
}

function actualizarContadorBadgeHeader() {
    const badge = document.getElementById('cartBadge');
    if (!badge || !mesaDispositivo) return;

    const comanda = obtenerComandaMesa(mesaDispositivo);
    const totalCant = comanda.items.reduce((acc, item) => acc + item.cantidad, 0);
    badge.textContent = totalCant;
}

function sincronizarIframeCarrito() {
    const iframe = document.getElementById('cartIframe');
    if (iframe && iframe.contentWindow) {
        try {
            if (typeof iframe.contentWindow.cargarComandaIframe === 'function') {
                iframe.contentWindow.cargarComandaIframe();
            }
        } catch (e) {
            console.log("Sincronizando comanda con iframe...", e);
        }
    }
}

// ===================================================
// RENDERIZADO DE LA REJILLA DE PRODUCTOS
// ===================================================

function obtenerProductosSQL(categoria = 'Todos') {
    let query = "SELECT * FROM productos";
    if (categoria !== 'Todos') query += ` WHERE categoria = '${categoria}'`;
    const res = db.exec(query);
    if (res.length === 0) return [];
    const cols = res[0].columns;
    return res[0].values.map(r => Object.fromEntries(r.map((v, i) => [cols[i], v])));
}

function renderizarProductosUI(categoria = 'Todos') {
    const container = document.getElementById('productsContainer');
    if (!container) return;

    const productos = obtenerProductosSQL(categoria);
    container.innerHTML = '';

    if (productos.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7A6A60;">No hay productos disponibles.</p>';
        return;
    }

    productos.forEach(prod => {
        container.innerHTML += `
            <article class="card">
                <div class="card-img">
                    <img src="${prod.imagen}" alt="${prod.nombre}">
                    <span class="badge-tag">${prod.categoria}</span>
                </div>
                <div class="card-body">
                    <div class="card-header">
                        <h3>${prod.nombre}</h3>
                        <span class="price">$${Number(prod.precio).toFixed(2)}</span>
                    </div>
                    <p class="description">${prod.descripcion || ''}</p>
                    <small style="color: #8C5A3C; font-weight: 600; margin-bottom: 12px; display: block;">Stock: ${prod.stock} ud.</small>
                    <div class="card-footer">
                        <button class="add-btn" onclick="agregarProductoAMesa(${prod.id})">
                            <i class="fa-solid fa-plus"></i> Pedir para Mesa
                        </button>
                    </div>
                </div>
            </article>
        `;
    });
}

// ===================================================
// EXPOSICIÓN AL ÁMBITO GLOBAL (WINDOW) PARA IFRAME
// ===================================================

window.obtenerComandaMesa = obtenerComandaMesa;
window.procesarVentaMesa = procesarVentaMesa;
window.incrementarCantidadDetalle = incrementarCantidadDetalle;
window.decrementarCantidadDetalle = decrementarCantidadDetalle;
window.eliminarDetalleOrden = eliminarDetalleOrden;
window.mesaDispositivo = mesaDispositivo;