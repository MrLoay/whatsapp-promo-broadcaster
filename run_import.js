const Database = require('better-sqlite3');
const db = new Database('/opt/whatsapp-broadcast/data/app.db');
db.prepare('DELETE FROM accounts').run();
const proxies = [
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10000",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10001",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10002",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10003",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10004",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10005",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10006",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10007",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10008",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10009",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10010",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10011",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10012",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10013",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10014",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10015",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10016",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10017",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10018",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10019",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10020",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10021",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10022",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10023",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10024",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10025",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10026",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10027",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10028",
    "f28d1cda6f6124c4114d__cr.my:1a5379961f3602a0@gw.dataimpulse.com:10029"
];
const stmt = db.prepare('INSERT INTO accounts (id, account_name, proxy_url, status) VALUES (?, ?, ?, ?)');
proxies.forEach((p, i) => {
    stmt.run('acc_' + (i+1), 'Account ' + (i+1), 'http://' + p, 'DISCONNECTED');
});
console.log('Done inserting 30 accounts.');
