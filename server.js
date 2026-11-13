const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path file data untuk persistensi sederhana
const DATA_FILE = path.join(__dirname, 'billing_data.json');
const HISTORY_FILE = path.join(__dirname, 'sessions_history.json');

// Inisialisasi State default
let state = {
    settings: {
        warnetName: "CYBERNET ESPORTS & GAMING",
        tagline: "High-Performance Gaming & Internet Lounge",
        ratePerHour: 5000,
        currency: "Rp"
    },
    packages: [
        { id: 'p1', name: 'Reguler 1 Jam', durationMinutes: 60, price: 5000, desc: 'Tarif standar per jam' },
        { id: 'p2', name: 'Paket Hemat 2 Jam', durationMinutes: 120, price: 9000, desc: 'Diskon hemat 10%' },
        { id: 'p3', name: 'Paket Gaming 3 Jam', durationMinutes: 180, price: 13000, desc: 'Favorit mabar ranked' },
        { id: 'p4', name: 'Paket Pro Gamer 5 Jam', durationMinutes: 300, price: 20000, desc: 'Puas seharian full speed' },
        { id: 'p5', name: 'Paket Begadang (Malam)', durationMinutes: 420, price: 25000, desc: '23:00 s/d 06:00 pagi' },
        { id: 'p_test', name: 'Testing Kasir (1 Menit)', durationMinutes: 1, price: 500, desc: 'Hanya untuk pengujian' }
    ],
    menuItems: [
        { id: 'f1', name: 'Indomie Goreng + Telur', category: 'Makanan', price: 10000, stock: 45, icon: 'fa-bowl-food' },
        { id: 'f2', name: 'Indomie Rebus Soto + Telur', category: 'Makanan', price: 10000, stock: 32, icon: 'fa-bowl-rice' },
        { id: 'f3', name: 'Nasi Goreng Spesial Kasir', category: 'Makanan', price: 15000, stock: 15, icon: 'fa-plate-wheat' },
        { id: 'd1', name: 'Es Teh Manis Jumbo', category: 'Minuman', price: 4000, stock: 100, icon: 'fa-glass-water' },
        { id: 'd2', name: 'Kopi Hitam Panas / Good Day', category: 'Minuman', price: 5000, stock: 60, icon: 'fa-mug-hot' },
        { id: 'd3', name: 'Extra Joss Susu Dingin', category: 'Minuman', price: 7000, stock: 40, icon: 'fa-glass-water-droplet' },
        { id: 's1', name: 'Chitato / Snack Ringan', category: 'Snack', price: 6000, stock: 25, icon: 'fa-cookie-bite' },
        { id: 's2', name: 'Rokok Gudang Garam Filter (Batang)', category: 'Lainnya', price: 3000, stock: 50, icon: 'fa-smoking' }
    ],
    members: [
        { id: 'm1', username: 'pro_gamer', name: 'Rian Pratama', phone: '08123456789', balance: 50000, role: 'VIP Member' },
        { id: 'm2', username: 'indra99', name: 'Indra Wijaya', phone: '08987654321', balance: 15000, role: 'Regular' },
        { id: 'm3', username: 'speeddemon', name: 'Kevin Santoso', phone: '08571234432', balance: 0, role: 'Regular' }
    ],
    pcs: [
        { id: 'PC-01', name: 'PC-01 (VIP Ultra)', spec: 'i7 13700KF | RTX 4070 | 240Hz', group: 'VIP', status: 'available', session: null },
        { id: 'PC-02', name: 'PC-02 (VIP Ultra)', spec: 'i7 13700KF | RTX 4070 | 240Hz', group: 'VIP', status: 'available', session: null },
        { id: 'PC-03', name: 'PC-03 (Reguler Gaming)', spec: 'i5 12400F | RTX 3060 | 165Hz', group: 'Reguler', status: 'available', session: null },
        { id: 'PC-04', name: 'PC-04 (Reguler Gaming)', spec: 'i5 12400F | RTX 3060 | 165Hz', group: 'Reguler', status: 'available', session: null },
        { id: 'PC-05', name: 'PC-05 (Reguler Gaming)', spec: 'i5 12400F | RTX 3060 | 165Hz', group: 'Reguler', status: 'available', session: null },
        { id: 'PC-06', name: 'PC-06 (Reguler Gaming)', spec: 'i5 12400F | RTX 3060 | 165Hz', group: 'Reguler', status: 'available', session: null }
    ],
    transactions: [],
    cashierShift: {
        activeUser: "Kasir Jo",
        startedAt: new Date().toISOString(),
        startCash: 100000
    }
};

// Muat data jika ada file tersimpan
if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (loaded && loaded.pcs) {
            state = { ...state, ...loaded };
        }
    } catch (e) {
        console.error('Gagal memuat billing_data.json, gunakan state default', e.message);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('Gagal menyimpan file:', e.message);
    }
}

let clientSockets = {}; // Menyimpan ws client PC [pcName: ws]
let adminSockets = new Set(); // Menyimpan ws dashboard kasir/admin

// Hitung interval timer sesi aktif tiap detik
setInterval(() => {
    let stateChanged = false;
    const now = Date.now();

    state.pcs.forEach(pc => {
        if (pc.session && pc.status === 'in_use') {
            if (pc.session.type === 'prepaid') {
                const elapsedSeconds = Math.floor((now - pc.session.startTime) / 1000);
                const remaining = pc.session.totalSeconds - elapsedSeconds;

                if (remaining <= 0) {
                    // Waktu habis! Kunci PC otomatis
                    pc.session.remainingSeconds = 0;
                    pc.status = 'available';
                    const closedSession = pc.session;

                    // --- Simpan ke riwayat sesi selesai ---
                    try {
                        let history = [];
                        if (fs.existsSync(HISTORY_FILE)) {
                            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                        }
                        history.unshift({
                            pcId: pc.id,
                            customerName: closedSession.customerName,
                            type: closedSession.type,
                            durationMinutes: Math.floor(closedSession.totalSeconds / 60),
                            totalPrice: closedSession.price,
                            endedAt: new Date().toLocaleString('id-ID')
                        });
                        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 100), null, 2), 'utf8');
                    } catch (err) {
                        console.error('Gagal menulis history sesi:', err.message);
                    }

                    pc.session = null;
                    stateChanged = true;

                    // Beri tahu client socket untuk lock
                    if (clientSockets[pc.id] && clientSockets[pc.id].readyState === WebSocket.OPEN) {
                        clientSockets[pc.id].send(JSON.stringify({ action: 'lock_pc' }));
                    }

                    broadcastToAdmins({
                        event: 'session_expired',
                        pcName: pc.id,
                        message: `Waktu bermain di ${pc.id} telah habis!`
                    });
                } else {
                    pc.session.remainingSeconds = remaining;
                }
            } else if (pc.session.type === 'postpaid') {
                // Open time billing
                const elapsedSeconds = Math.floor((now - pc.session.startTime) / 1000);
                pc.session.elapsedSeconds = elapsedSeconds;
                const hours = elapsedSeconds / 3600;
                pc.session.currentCost = Math.ceil((hours * state.settings.ratePerHour) / 500) * 500;
            }
        }
    });

    if (adminSockets.size > 0) {
        broadcastAdminState();
    }
}, 1000);

// WebSocket Handler
wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }

        if (data.event === 'register_pc') {
            const pcName = data.pcName;
            clientSockets[pcName] = ws;
            ws.pcName = pcName;
            console.log(`[PC Terhubung] ${pcName}`);

            let pc = state.pcs.find(p => p.id === pcName);
            if (!pc) {
                pc = {
                    id: pcName,
                    name: pcName,
                    spec: 'Client Standar',
                    group: 'Reguler',
                    status: 'available',
                    session: null
                };
                state.pcs.push(pc);
            }

            if (pc.status === 'available') {
                ws.send(JSON.stringify({ action: 'lock_pc' }));
            } else if (pc.session) {
                ws.send(JSON.stringify({ 
                    action: 'unlock_pc', 
                    duration: pc.session.remainingSeconds || 3600 
                }));
            }

            broadcastAdminState();
            saveData();
        }

        if (data.event === 'register_admin') {
            adminSockets.add(ws);
            console.log('[Kasir Admin Terhubung]');
            sendAdminFullState(ws);
        }

        if (data.event === 'start_session') {
            const { pcName, customerName, type, durationMinutes, price, packageId } = data;
            const pc = state.pcs.find(p => p.id === pcName);
            if (pc) {
                const durationSeconds = (durationMinutes || 60) * 60;
                pc.status = 'in_use';
                pc.session = {
                    customerName: customerName || 'Tamu Pelanggan',
                    type: type || 'prepaid',
                    startTime: Date.now(),
                    totalSeconds: durationSeconds,
                    remainingSeconds: durationSeconds,
                    elapsedSeconds: 0,
                    price: price || 0,
                    packageId: packageId || null,
                    fnbOrders: []
                };

                state.transactions.unshift({
                    id: 'TRX-' + Date.now().toString().slice(-6),
                    time: new Date().toLocaleTimeString('id-ID'),
                    date: new Date().toLocaleDateString('id-ID'),
                    type: 'Billing',
                    description: `Sewa ${pc.id} (${customerName || 'Tamu'}) - ${durationMinutes} Menit`,
                    amount: price || 0,
                    paymentMethod: 'Cash',
                    cashier: state.cashierShift.activeUser
                });

                if (clientSockets[pcName] && clientSockets[pcName].readyState === WebSocket.OPEN) {
                    clientSockets[pcName].send(JSON.stringify({ 
                        action: 'unlock_pc', 
                        duration: durationSeconds 
                    }));
                }

                saveData();
                broadcastAdminState();
            }
        }

        if (data.event === 'add_time') {
            const { pcName, addMinutes, price } = data;
            const pc = state.pcs.find(p => p.id === pcName);
            if (pc && pc.session) {
                const addSeconds = addMinutes * 60;
                pc.session.totalSeconds += addSeconds;
                pc.session.remainingSeconds += addSeconds;
                pc.session.price += (price || 0);

                state.transactions.unshift({
                    id: 'TRX-' + Date.now().toString().slice(-6),
                    time: new Date().toLocaleTimeString('id-ID'),
                    date: new Date().toLocaleDateString('id-ID'),
                    type: 'Billing (Tambah Jam)',
                    description: `Tambah ${addMinutes} Menit di ${pc.id}`,
                    amount: price || 0,
                    paymentMethod: 'Cash',
                    cashier: state.cashierShift.activeUser
                });

                if (clientSockets[pcName] && clientSockets[pcName].readyState === WebSocket.OPEN) {
                    clientSockets[pcName].send(JSON.stringify({ 
                        action: 'add_time', 
                        additionalSeconds: addSeconds,
                        newRemaining: pc.session.remainingSeconds
                    }));
                }

                saveData();
                broadcastAdminState();
            }
        }

        if (data.event === 'stop_session' || (data.event === 'admin_command' && data.action === 'lock_pc')) {
            const pcName = data.pcName;
            const pc = state.pcs.find(p => p.id === pcName);
            if (pc) {
                pc.status = 'available';
                pc.session = null;

                if (clientSockets[pcName] && clientSockets[pcName].readyState === WebSocket.OPEN) {
                    clientSockets[pcName].send(JSON.stringify({ action: 'lock_pc' }));
                }

                saveData();
                broadcastAdminState();
            }
        }

        if (data.event === 'transfer_session') {
            const { fromPc, toPc } = data;
            const sourcePc = state.pcs.find(p => p.id === fromPc);
            const targetPc = state.pcs.find(p => p.id === toPc);

            if (sourcePc && targetPc && sourcePc.session && targetPc.status === 'available') {
                targetPc.session = { ...sourcePc.session };
                targetPc.status = 'in_use';

                sourcePc.session = null;
                sourcePc.status = 'available';

                if (clientSockets[fromPc] && clientSockets[fromPc].readyState === WebSocket.OPEN) {
                    clientSockets[fromPc].send(JSON.stringify({ action: 'lock_pc' }));
                }

                if (clientSockets[toPc] && clientSockets[toPc].readyState === WebSocket.OPEN) {
                    clientSockets[toPc].send(JSON.stringify({ 
                        action: 'unlock_pc', 
                        duration: targetPc.session.remainingSeconds 
                    }));
                }

                saveData();
                broadcastAdminState();
            }
        }

        if (data.event === 'order_fnb') {
            const { pcName, items, totalAmount, paymentMethod } = data;
            let orderDesc = [];

            items.forEach(item => {
                const stockItem = state.menuItems.find(m => m.id === item.id);
                if (stockItem) {
                    stockItem.stock = Math.max(0, stockItem.stock - item.qty);
                    orderDesc.push(`${stockItem.name} (${item.qty}x)`);
                }
            });

            state.transactions.unshift({
                id: 'TRX-' + Date.now().toString().slice(-6),
                time: new Date().toLocaleTimeString('id-ID'),
                date: new Date().toLocaleDateString('id-ID'),
                type: 'Kantin / F&B',
                description: `${pcName ? `[${pcName}] ` : ''}${orderDesc.join(', ')}`,
                amount: totalAmount,
                paymentMethod: paymentMethod || 'Cash',
                cashier: state.cashierShift.activeUser
            });

            saveData();
            broadcastAdminState();
        }

        if (data.event === 'topup_member') {
            const { memberId, amount } = data;
            const member = state.members.find(m => m.id === memberId);
            if (member) {
                member.balance += amount;

                state.transactions.unshift({
                    id: 'TRX-' + Date.now().toString().slice(-6),
                    time: new Date().toLocaleTimeString('id-ID'),
                    date: new Date().toLocaleDateString('id-ID'),
                    type: 'Topup Member',
                    description: `Top up saldo [${member.username}] ${member.name}`,
                    amount: amount,
                    paymentMethod: 'Cash',
                    cashier: state.cashierShift.activeUser
                });

                saveData();
                broadcastAdminState();
            }
        }

        if (data.event === 'add_member') {
            const newMember = {
                id: 'm' + (state.members.length + 1),
                username: data.username,
                name: data.name,
                phone: data.phone || '-',
                balance: Number(data.initialDeposit) || 0,
                role: 'Regular Member'
            };
            state.members.push(newMember);

            if (newMember.balance > 0) {
                state.transactions.unshift({
                    id: 'TRX-' + Date.now().toString().slice(-6),
                    time: new Date().toLocaleTimeString('id-ID'),
                    date: new Date().toLocaleDateString('id-ID'),
                    type: 'Deposit Member Baru',
                    description: `Registrasi & Deposit [${newMember.username}]`,
                    amount: newMember.balance,
                    paymentMethod: 'Cash',
                    cashier: state.cashierShift.activeUser
                });
            }

            saveData();
            broadcastAdminState();
        }

        if (data.event === 'add_pc') {
            const pcNumber = state.pcs.length + 1;
            const defaultId = `PC-${pcNumber < 10 ? '0' + pcNumber : pcNumber}`;
            const newPc = {
                id: data.id || defaultId,
                name: data.name || `${defaultId} (Gaming)`,
                spec: data.spec || 'i5 | RTX 3060 | 165Hz',
                group: data.group || 'Reguler',
                status: 'available',
                session: null
            };
            state.pcs.push(newPc);
            saveData();
            broadcastAdminState();
        }

        if (data.event === 'send_chat') {
            const { pcName, message } = data;
            if (pcName === 'ALL') {
                Object.values(clientSockets).forEach(clientWs => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ action: 'popup_message', message: message }));
                    }
                });
            } else if (clientSockets[pcName] && clientSockets[pcName].readyState === WebSocket.OPEN) {
                clientSockets[pcName].send(JSON.stringify({ action: 'popup_message', message: message }));
            }
        }
    });

    ws.on('close', () => {
        if (ws.pcName) {
            console.log(`[PC Terputus] ${ws.pcName}`);
            delete clientSockets[ws.pcName];
            broadcastAdminState();
        } else {
            adminSockets.delete(ws);
        }
    });
});

function broadcastAdminState() {
    const onlinePcs = Object.keys(clientSockets);
    const enrichedPcs = state.pcs.map(pc => ({
        ...pc,
        isClientConnected: onlinePcs.includes(pc.id)
    }));

    const msg = JSON.stringify({
        event: 'full_sync',
        state: {
            ...state,
            pcs: enrichedPcs,
            onlineCount: onlinePcs.length
        }
    });

    adminSockets.forEach(admin => {
        if (admin.readyState === WebSocket.OPEN) {
            admin.send(msg);
        }
    });
}

function sendAdminFullState(adminWs) {
    const onlinePcs = Object.keys(clientSockets);
    const enrichedPcs = state.pcs.map(pc => ({
        ...pc,
        isClientConnected: onlinePcs.includes(pc.id)
    }));

    adminWs.send(JSON.stringify({
        event: 'full_sync',
        state: {
            ...state,
            pcs: enrichedPcs,
            onlineCount: onlinePcs.length
        }
    }));
}

function broadcastToAdmins(payload) {
    const msg = JSON.stringify(payload);
    adminSockets.forEach(admin => {
        if (admin.readyState === WebSocket.OPEN) {
            admin.send(msg);
        }
    });
}

// --- API Endpoint untuk Mengambil Riwayat Sesi Selesai ---
app.get('/api/history', (req, res) => {
    try {
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`   CYBERNET PRO BILLING SYSTEM - SERVER RUNNING        `);
    console.log(`   Dashboard Kasir : http://localhost:${PORT}          `);
    console.log(`=======================================================`);
});