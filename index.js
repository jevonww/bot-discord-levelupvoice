// ============================================================================
//  BOT DISCORD - VOICE LEVELING & AUTO-ROLE (discord.js v14, ES Module)
//
//  Instal   : npm install discord.js
//  Jalankan : node index.js        (butuh Node.js 18 ke atas)
//  Token    : isi TOKEN di bawah, atau set environment variable DISCORD_TOKEN
//
//  Di Discord Developer Portal > Bot, aktifkan "Message Content Intent".
//  Izin bot di server: View Channel, Send Messages, Embed Links, Manage Roles.
//  Role bot harus berada DI ATAS semua role hadiah di Server Settings > Roles.
//
//  Catatan  : file ini sengaja ASCII-only. Semua emoji ditulis dengan kode
//             \u{...} supaya aman dibuka di Notepad Windows.
// ============================================================================
import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField,
    Events
} from 'discord.js';
import fs from 'fs';

// ----------------------------------------------------------------------------
// KONFIGURASI
// ----------------------------------------------------------------------------
const TOKEN = process.env.DISCORD_TOKEN || ''; // Token wajib dari environment/.env, jangan hardcode
const PREFIX = '!';
const FILE_DATA = 'voice_levels.json';

// ID channel teks untuk pengumuman level up.
// Kosongkan ('') untuk memakai channel teks pertama yang bisa dipakai bot.
const ID_CHANNEL_LEVELUP = '1572427602751262730';

const XP_PER_MENIT = 20;           // XP yang didapat tiap menit di voice
const INTERVAL_MS = 60000;         // pengecekan voice tiap 1 menit
const COOLDOWN_PERINTAH_MS = 3000; // jeda antar perintah per pengguna

// Peta level -> ID Role Discord hadiah.
// Cara ambil ID: Server Settings > Roles > klik kanan role > Copy Role ID
// (aktifkan Developer Mode di User Settings > Advanced).
const ROLE_HADIAH = {
    1: '1572437551682420736',
    3: '1572437550885503086',
    10: '1572437550067359784',
    20: '1572437549429825576',
    35: '1572437548591095979',
    50: '1572437547819208774',
    75: '1572437542928908288',
    100: '1572437527023845386'
};
const NAMA_ROLE_HADIAH = {
    1: 'Boti Baru Nyebur', 3: 'Anak Baru', 10: 'Langganan',
    20: 'Penghuni Tetap', 35: 'Senior', 50: 'Suhu',
    75: 'Abang-Abangan', 100: 'Sepuh'
};
const OWNER_ID = '904284081334939699';

const LEVEL_LEGEND = 100;      // level yang membuat anggota menjadi LEGEND

// ----------------------------------------------------------------------------
// EMOJI & WARNA (kode Unicode)
// ----------------------------------------------------------------------------
const EMOJI = {
    hijau: '\u{1F7E9}', hitam: '\u{2B1B}', juara1: '\u{1F947}', juara2: '\u{1F948}',
    juara3: '\u{1F949}', party: '\u{1F389}', mic: '\u{1F3A4}', trophy: '\u{1F3C6}',
    gift: '\u{1F381}', chart: '\u{1F4CA}', clock: '\u{23F1}\u{FE0F}', list: '\u{1F4CB}',
    panah: '\u{27A1}\u{FE0F}', cross: '\u{274C}', warn: '\u{26A0}\u{FE0F}', bintang: '\u{2B50}',
    crown: '\u{1F451}', naik: '\u{1F53C}'
};
const WARNA = { utama: 0x5865f2, emas: 0xf1c40f, hijau: 0x2ecc71, merah: 0xe74c3c, ungu: 0x9b59b6 };
const TITIK = '\u{2022}';

// ----------------------------------------------------------------------------
// DATA (voice_levels.json) - format: { guildId: { userId: { xp, level, menit } } }
// ----------------------------------------------------------------------------
let data = {};
let berubah = false;

function muatData() {
    if (!fs.existsSync(FILE_DATA)) {
        fs.writeFileSync(FILE_DATA, '{}');
        return {};
    }
    try {
        const d = JSON.parse(fs.readFileSync(FILE_DATA, 'utf-8'));
        if (d && typeof d === 'object' && !Array.isArray(d)) return d;
        throw new Error('format tidak sesuai');
    } catch (e) {
        const cadangan = `voice_levels_rusak_${Date.now()}.json`;
        fs.renameSync(FILE_DATA, cadangan);
        console.log(`[DATA] File rusak (${e.message}). Dicadangkan ke ${cadangan}, mulai dari data kosong.`);
        return {};
    }
}

// Tulis atomik: file sementara dulu, lalu diganti, supaya file utama tidak rusak
function simpanData() {
    if (!berubah) return;
    try {
        const tmp = FILE_DATA + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, FILE_DATA);
        berubah = false;
    } catch (e) {
        console.log('[DATA] Gagal menyimpan, akan dicoba lagi:', e.message);
    }
}

const dataKosong = () => ({ xp: 0, level: 0, menit: 0 });

function ambilPengguna(guildId, userId) {
    return data[guildId]?.[userId] ?? dataKosong();
}

function pastikanPengguna(guildId, userId) {
    data[guildId] ??= {};
    data[guildId][userId] ??= dataKosong();
    return data[guildId][userId];
}

// ----------------------------------------------------------------------------
// RUMUS & FORMAT
// ----------------------------------------------------------------------------
const xpTarget = (level) => (level + 1) * 100;
const totalXp = (u) => 50 * u.level * (u.level + 1) + u.xp;   // akumulasi XP sejak level 0
const idValid = (id) => typeof id === 'string' && /^\d{17,20}$/.test(id);
const levelHadiah = () => Object.keys(ROLE_HADIAH).map(Number).sort((a, b) => a - b);

// Tambahan teks gelar untuk anggota yang sudah mencapai Level 100
const labelLegend = (level) => (level >= LEVEL_LEGEND ? ` ${EMOJI.crown} **LEGEND**` : '');

// Warna Embed level up berubah mengikuti tingkatan level
const warnaLevel = (level) =>
    level >= LEVEL_LEGEND ? 0x9b59b6 :
    level >= 50 ? 0xe91e63 :
    level >= 35 ? 0xe74c3c :
    level >= 20 ? 0xe67e22 :
    level >= 10 ? 0xf1c40f :
    level >= 3 ? 0x2ecc71 : 0x3498db;

function infoHadiahBerikut(level) {
    const lvl = levelHadiah().find((l) => l > level);
    return lvl ? `Level ${lvl} (${lvl - level} level lagi)` : 'Semua hadiah sudah terbuka!';
}

// Ucapan selamat acak supaya notifikasi tidak monoton ({m} = mention anggota)
const UCAPAN = [
    'Mantap {m}! Nongkrong di voice-mu membuahkan hasil.',
    'GG {m}! Satu langkah lagi menuju puncak.',
    'Konsisten banget, {m}! Level kamu naik lagi.',
    'Sikat terus, {m}! Voice sudah seperti rumah kedua.',
    'Respect untuk {m}! Dedikasi di voice tidak bohong.',
    'Naik kelas, {m}! Jangan berhenti sekarang.'
];
const pilihAcak = (arr) => arr[Math.floor(Math.random() * arr.length)];

function formatDurasi(menit) {
    return `${Math.floor(menit / 60)} jam ${menit % 60} menit`;
}

function barProgress(xp, target, panjang = 10) {
    const isi = Math.max(0, Math.min(panjang, Math.floor((xp / target) * panjang)));
    return EMOJI.hijau.repeat(isi) + EMOJI.hitam.repeat(panjang - isi);
}

// Urutan peringkat server: total XP tertinggi dulu, hanya yang pernah di voice
function urutanPeringkat(guildId) {
    return Object.entries(data[guildId] ?? {})
        .filter(([, u]) => u.menit > 0)
        .sort((a, b) => totalXp(b[1]) - totalXp(a[1]) || b[1].menit - a[1].menit);
}

// ----------------------------------------------------------------------------
// CLIENT
// ----------------------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let tickBerjalan = false;

// ----------------------------------------------------------------------------
// LEVEL UP & HADIAH ROLE
// ----------------------------------------------------------------------------
async function berikanRole(guild, member, level) {
    const id = ROLE_HADIAH[level];
    if (!idValid(id)) return null;

    const role = guild.roles.cache.get(id);
    if (!role) {
        console.log(`[ROLE] Role level ${level} (${id}) tidak ditemukan di server "${guild.name}".`);
        return null;
    }
    if (member.roles.cache.has(id)) return null;
    if (!role.editable) {
        console.log(`[ROLE] Bot tidak bisa memberi role "${role.name}". Pindahkan role bot ke atas role itu dan pastikan izin Manage Roles aktif.`);
        return null;
    }
    try {
        await member.roles.add(role, `Hadiah level ${level} voice`);
        return role;
    } catch (e) {
        console.log(`[ROLE] Gagal menambahkan role "${role.name}":`, e.message);
        return null;
    }
}

function cariChannelLevelUp(guild) {
    const flags = PermissionsBitField.Flags;
    const bisaKirim = (c) =>
        c?.type === ChannelType.GuildText &&
        c.permissionsFor(guild.members.me)?.has([flags.ViewChannel, flags.SendMessages, flags.EmbedLinks]);

    if (ID_CHANNEL_LEVELUP) {
        const c = guild.channels.cache.get(ID_CHANNEL_LEVELUP);
        if (bisaKirim(c)) return c;
    }
    return guild.channels.cache
        .filter(bisaKirim)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first() ?? null;
}

async function tanganiLevelUp(guild, member, u, levelDicapai) {
    const roleBaru = [];
    for (const lvl of levelDicapai) {
        const role = await berikanRole(guild, member, lvl);
        if (role) roleBaru.push(role);
    }

    const channel = cariChannelLevelUp(guild);
    if (!channel) return;

    const jadiLegend = levelDicapai.includes(LEVEL_LEGEND);
    const milestone = levelDicapai.some((l) => Object.hasOwn(ROLE_HADIAH, l));
    const sebelum = levelDicapai[0] - 1;
    const tujuan = xpTarget(u.level);
    const menitLagi = Math.ceil((tujuan - u.xp) / XP_PER_MENIT);
    const daftar = urutanPeringkat(guild.id);
    const idx = daftar.findIndex(([id]) => id === member.id);

    const judul = jadiLegend ? `${EMOJI.crown} LEGEND BARU!`
        : milestone ? `${EMOJI.gift} LEVEL HADIAH TERBUKA!`
        : `${EMOJI.party} LEVEL UP!`;
    const sambutan = jadiLegend
        ? `${member} mencapai **Level ${LEVEL_LEGEND}** dan resmi menjadi **LEGEND** server ini!`
        : pilihAcak(UCAPAN).replace('{m}', `${member}`);

    const embed = new EmbedBuilder()
        .setColor(warnaLevel(u.level))
        .setAuthor({ name: `${member.displayName} naik level!`, iconURL: member.displayAvatarURL() })
        .setTitle(judul)
        .setDescription(
            `${sambutan}\n\n` +
            `${EMOJI.naik} **Level ${sebelum}** ${EMOJI.panah} **Level ${u.level}**${labelLegend(u.level)}`
        )
        .setThumbnail(member.displayAvatarURL())
        .addFields(
            { name: `${EMOJI.trophy} Peringkat`, value: idx >= 0 ? `#${idx + 1} dari ${daftar.length}` : '-', inline: true },
            { name: `${EMOJI.clock} Total Voice`, value: formatDurasi(u.menit), inline: true },
            {
                name: `${EMOJI.chart} Menuju Level ${u.level + 1}`,
                value: `Butuh sekitar **${formatDurasi(menitLagi)}** di voice (${tujuan - u.xp} XP lagi)`
            }
        )
        .setFooter({
            text: `${guild.name} ${TITIK} Terus nongkrong di voice untuk naik lagi!`,
            iconURL: guild.iconURL() ?? undefined
        })
        .setTimestamp();

    if (roleBaru.length) {
        embed.addFields({
            name: `${EMOJI.gift} Hadiah Role Baru`,
            value: roleBaru.map((r) => `${r}`).join(', ')
        });
    }
    embed.addFields({ name: `${EMOJI.gift} Hadiah Berikutnya`, value: infoHadiahBerikut(u.level) });

    await channel.send({
        content: `${member}`,
        embeds: [embed],
        allowedMentions: { users: [member.id] }
    });
}

// ----------------------------------------------------------------------------
// PENGHITUNGAN VOICE TIAP 1 MENIT
// ----------------------------------------------------------------------------
async function prosesVoiceState(guild, vs) {
    if (!vs.channelId) return;                         // tidak sedang di voice
    if (vs.channelId === guild.afkChannelId) return;   // channel AFK
    if (vs.selfDeaf) return;                           // menulikan diri sendiri

    const member = vs.member ?? await guild.members.fetch(vs.id).catch(() => null);
    if (!member || member.user.bot) return;

    const u = pastikanPengguna(guild.id, member.id);
    u.xp += XP_PER_MENIT;
    u.menit += 1;
    berubah = true;

    const levelDicapai = [];
    while (u.xp >= xpTarget(u.level)) {
        u.xp -= xpTarget(u.level);
        u.level += 1;
        levelDicapai.push(u.level);
    }

    if (levelDicapai.length) {
        simpanData();   // simpan segera saat level up, sebelum mengirim pesan
        await tanganiLevelUp(guild, member, u, levelDicapai);
    }
}

async function prosesTick() {
    if (tickBerjalan) return;
    tickBerjalan = true;
    try {
        for (const guild of client.guilds.cache.values()) {
            for (const vs of [...guild.voiceStates.cache.values()]) {
                try {
                    await prosesVoiceState(guild, vs);
                } catch (e) {
                    console.log(`[VOICE] Error di "${guild.name}":`, e.message);
                }
            }
        }
        simpanData();
    } finally {
        tickBerjalan = false;
    }
}

// ----------------------------------------------------------------------------
// PERINTAH TEKS
// ----------------------------------------------------------------------------
const balas = (message, embed) =>
    message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

const embedPesan = (warna, teks) => new EmbedBuilder().setColor(warna).setDescription(teks);

// Target: mention @user di isi pesan (bukan mention dari reply), atau ID pengguna
async function ambilTarget(message, args) {
    const isi = message.content;
    const mention = message.mentions.users.find(
        (u) => isi.includes(`<@${u.id}>`) || isi.includes(`<@!${u.id}>`)
    );
    if (mention) return mention;
    if (args[0] && /^\d{17,20}$/.test(args[0])) {
        return client.users.fetch(args[0]).catch(() => null);
    }
    return message.author;
}

async function cmdRank(message, args) {
    const target = await ambilTarget(message, args);
    if (!target) return balas(message, embedPesan(WARNA.merah, `${EMOJI.cross} Pengguna tidak ditemukan.`));
    if (target.bot) return balas(message, embedPesan(WARNA.merah, `${EMOJI.cross} Bot tidak punya level.`));

    const u = ambilPengguna(message.guild.id, target.id);
    const tujuan = xpTarget(u.level);
    const persen = Math.floor((u.xp / tujuan) * 100);

    const daftar = urutanPeringkat(message.guild.id);
    const idx = daftar.findIndex(([id]) => id === target.id);
    const peringkat = idx >= 0 ? `#${idx + 1} dari ${daftar.length}` : 'Belum masuk peringkat';

    const infoHadiah = infoHadiahBerikut(u.level);

    const anggota = await message.guild.members.fetch(target.id).catch(() => null);
    const nama = anggota?.displayName ?? target.username;
    const avatar = (anggota ?? target).displayAvatarURL();

    const embed = new EmbedBuilder()
        .setColor(WARNA.utama)
        .setAuthor({ name: `Rank Voice ${TITIK} ${nama}`, iconURL: avatar })
        .setThumbnail(avatar)
        .addFields(
            { name: `${EMOJI.bintang} Level`, value: `**${u.level}**${labelLegend(u.level)}`, inline: true },
            { name: `${EMOJI.chart} XP`, value: `${u.xp} / ${tujuan}`, inline: true },
            { name: `${EMOJI.trophy} Peringkat`, value: peringkat, inline: true },
            { name: `${EMOJI.clock} Total Voice`, value: formatDurasi(u.menit), inline: true },
            { name: `${EMOJI.gift} Hadiah Berikutnya`, value: infoHadiah, inline: true },
            { name: 'Progress', value: `${barProgress(u.xp, tujuan)} **${persen}%**` }
        )
        .setFooter({ text: `${XP_PER_MENIT} XP per menit di voice` })
        .setTimestamp();

    return balas(message, embed);
}

async function cmdTop(message) {
    const daftar = urutanPeringkat(message.guild.id).slice(0, 10);
    if (!daftar.length) {
        return balas(message, embedPesan(WARNA.utama, 'Belum ada data. Yuk mulai nongkrong di voice channel!'));
    }
    const medali = [EMOJI.juara1, EMOJI.juara2, EMOJI.juara3];
    const baris = daftar.map(([id, u], i) =>
        `${medali[i] ?? `**#${i + 1}**`} <@${id}>\n` +
        `Level **${u.level}**${labelLegend(u.level)} ${TITIK} ${u.xp}/${xpTarget(u.level)} XP ${TITIK} ${formatDurasi(u.menit)}`
    );

    const embed = new EmbedBuilder()
        .setColor(WARNA.emas)
        .setTitle(`${EMOJI.trophy} Leaderboard Voice - ${message.guild.name}`)
        .setDescription(baris.join('\n\n'))
        .setFooter({ text: '10 besar berdasarkan total XP voice' })
        .setTimestamp();

    return balas(message, embed);
}

async function cmdRewards(message) {
    const baris = levelHadiah().map((lvl) => {
        const id = ROLE_HADIAH[lvl];
        const gelar = lvl === LEVEL_LEGEND ? ` (${EMOJI.crown} LEGEND)` : '';
        return `${EMOJI.panah} **Level ${lvl} — ${NAMA_ROLE_HADIAH[lvl]}**${gelar} ${TITIK} ${idValid(id) ? `<@&${id}>` : '_belum diatur_'}`;
    });

    const embed = new EmbedBuilder()
        .setColor(WARNA.hijau)
        .setTitle(`${EMOJI.gift} Hadiah Level Voice`)
        .setDescription(
            baris.join('\n') +
            '\n\nRole diberikan otomatis saat kamu mencapai level tersebut.'
        )
        .setFooter({ text: 'Cek progresmu dengan !rank' });

    return balas(message, embed);
}

async function cmdMenu(message) {
    const p = PREFIX;
    const embed = new EmbedBuilder()
        .setColor(WARNA.utama)
        .setTitle(`${EMOJI.list} Menu Bot Voice Leveling`)
        .setDescription(
            `Nongkrong di voice channel untuk dapat **${XP_PER_MENIT} XP per menit**, naik level, ` +
            'dan buka role hadiah!'
        )
        .addFields(
            { name: `${p}rank / ${p}level [@user]`, value: 'Lihat level, XP, total voice, dan progress bar.' },
            { name: `${p}top / ${p}leaderboard`, value: 'Lihat 10 besar anggota voice tertinggi.' },
            { name: `${p}rewards / ${p}hadiah`, value: 'Lihat daftar level hadiah dan role-nya.' },
            { name: `${p}menu`, value: 'Tampilkan menu ini.' },
            { name: 'Command owner', value: '`!addxp`, `!removexp`, `!setxp`, `!setlevel`, `!resetlevel`, `!addlevel`, `!setmenit`, `!givereward`, `!reloadroles` (khusus owner).' }
        )
        .setFooter({ text: 'XP tidak bertambah di channel AFK atau saat deafen' });

    return balas(message, embed);
}

// ----------------------------------------------------------------------------
// OWNER-ONLY COMMANDS
// ----------------------------------------------------------------------------
function pemilik(message) {
    return message.author.id === OWNER_ID;
}

function targetDanAngka(message, args) {
    const mention = message.mentions.users.first();
    const idIndex = args.findIndex((v) => /^\d{17,20}$/.test(v));
    const targetId = mention?.id ?? (idIndex >= 0 ? args[idIndex] : null);
    const angkaIndex = mention ? args.findIndex((v) => /^-?\d+$/.test(v))
        : (idIndex >= 0 ? args.findIndex((v, i) => i > idIndex && /^-?\d+$/.test(v)) : -1);
    const angka = angkaIndex >= 0 ? Number(args[angkaIndex]) : null;
    return { targetId, angka };
}
async function ambilMemberTarget(message, targetId) {
    if (!targetId) return null;
    return message.guild.members.fetch(targetId).catch(() => null);
}
function levelDariTotalXp(total) {
    let level = 0;
    let xp = Math.max(0, Math.floor(total));
    while (xp >= xpTarget(level)) {
        xp -= xpTarget(level);
        level++;
    }
    return { level, xp };
}
async function sinkronRoleMember(guild, member, level) {
    const diberikan = [];
    for (const lvl of levelHadiah()) {
        if (lvl <= level) {
            const role = await berikanRole(guild, member, lvl);
            if (role) diberikan.push(role);
        }
    }
    return diberikan;
}
async function ownerBalas(message, teks, warna = WARNA.hijau) {
    return balas(message, embedPesan(warna, teks));
}
async function cmdAddXp(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka <= 0)
        return ownerBalas(message, `${EMOJI.cross} Format: !addxp @user jumlah`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    const sebelum = u.level;
    const total = totalXp(u) + angka;
    Object.assign(u, levelDariTotalXp(total));
    berubah = true;
    const levelDicapai = Array.from({ length: Math.max(0, u.level - sebelum) }, (_, i) => sebelum + i + 1);
    if (levelDicapai.length) await tanganiLevelUp(message.guild, member, u, levelDicapai);
    await sinkronRoleMember(message.guild, member, u.level);
    simpanData();
    return ownerBalas(message, `${EMOJI.naik} Berhasil menambahkan **${angka} XP** kepada ${member}. Level: **${sebelum} ? ${u.level}**.`);
}
async function cmdRemoveXp(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka <= 0)
        return ownerBalas(message, `${EMOJI.cross} Format: !removexp @user jumlah`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    const sebelum = u.level;
    Object.assign(u, levelDariTotalXp(Math.max(0, totalXp(u) - angka)));
    berubah = true;
    // Role hadiah sengaja tidak dicabut saat level turun.
    simpanData();
    return ownerBalas(message, `${EMOJI.chart} XP ${member} dikurangi **${angka}**. Level: **${sebelum} ? ${u.level}**. Role yang sudah dimiliki tetap dipertahankan.`);
}
async function cmdSetXp(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka < 0)
        return ownerBalas(message, `${EMOJI.cross} Format: !setxp @user jumlah (total XP)`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    const sebelum = u.level;
    Object.assign(u, levelDariTotalXp(angka));
    berubah = true;
    const levelDicapai = Array.from({ length: Math.max(0, u.level - sebelum) }, (_, i) => sebelum + i + 1);
    if (levelDicapai.length) await tanganiLevelUp(message.guild, member, u, levelDicapai);
    await sinkronRoleMember(message.guild, member, u.level);
    simpanData();
    return ownerBalas(message, `${EMOJI.chart} Total XP ${member} diatur ke **${angka}**. Level: **${sebelum} ? ${u.level}**.`);
}
async function cmdSetLevel(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka < 0 || angka > 1000)
        return ownerBalas(message, `${EMOJI.cross} Format: !setlevel @user level`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    const sebelum = u.level;
    u.level = angka; u.xp = 0; berubah = true;
    if (angka > sebelum) {
        const gained = Array.from({ length: angka - sebelum }, (_, i) => sebelum + i + 1);
        await tanganiLevelUp(message.guild, member, u, gained);
    }
    await sinkronRoleMember(message.guild, member, angka);
    simpanData();
    return ownerBalas(message, `${EMOJI.chart} Level ${member} diatur: **${sebelum} ? ${angka}** (XP level ini direset ke 0).`);
}
async function cmdAddLevel(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka <= 0 || angka > 1000)
        return ownerBalas(message, `${EMOJI.cross} Format: !addlevel @user jumlah (maksimal 1000)`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    const sebelum = u.level;
    u.level += angka; berubah = true;
    const gained = Array.from({ length: angka }, (_, i) => sebelum + i + 1);
    await tanganiLevelUp(message.guild, member, u, gained);
    await sinkronRoleMember(message.guild, member, u.level);
    simpanData();
    return ownerBalas(message, `${EMOJI.naik} Level ${member} ditambah **${angka}**: **${sebelum} ? ${u.level}**.`);
}
async function cmdResetLevel(message, args) {
    const { targetId } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot)
        return ownerBalas(message, `${EMOJI.cross} Format: !resetlevel @user`, WARNA.merah);
    data[message.guild.id] ??= {};
    data[message.guild.id][member.id] = dataKosong();
    berubah = true; simpanData();
    return ownerBalas(message, `${EMOJI.warn} Data level dan XP ${member} sudah direset. Role hadiah yang sudah dimiliki **tidak dicabut**.`);
}
async function cmdSetMenit(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Number.isInteger(angka) || angka < 0)
        return ownerBalas(message, `${EMOJI.cross} Format: !setmenit @user jumlah_menit`, WARNA.merah);
    const u = pastikanPengguna(message.guild.id, member.id);
    u.menit = angka; berubah = true; simpanData();
    return ownerBalas(message, `${EMOJI.clock} Total voice ${member} diatur menjadi **${formatDurasi(angka)}**.`);
}
async function cmdGiveReward(message, args) {
    const { targetId, angka } = targetDanAngka(message, args);
    const member = await ambilMemberTarget(message, targetId);
    if (!member || member.user.bot || !Object.hasOwn(ROLE_HADIAH, angka))
        return ownerBalas(message, `${EMOJI.cross} Format: !givereward @user level_hadiah (1, 3, 10, 20, 35, 50, 75, 100)`, WARNA.merah);
    const role = await berikanRole(message.guild, member, angka);
    if (!role) return ownerBalas(message, `${EMOJI.cross} Role level **${angka}** tidak berhasil diberikan. Cek ID role dan posisi role bot.`, WARNA.merah);
    return ownerBalas(message, `${EMOJI.gift} Role **${role.name}** berhasil diberikan kepada ${member}.`);
}
async function cmdReloadRoles(message) {
    let diperiksa = 0, ditambahkan = 0;
    const members = await message.guild.members.fetch();
    for (const member of members.values()) {
        if (member.user.bot) continue;
        const u = ambilPengguna(message.guild.id, member.id);
        if (u.level <= 0) continue;
        diperiksa++;
        ditambahkan += (await sinkronRoleMember(message.guild, member, u.level)).length;
    }
    simpanData();
    return ownerBalas(message, `${EMOJI.gift} Sinkronisasi role selesai. Anggota diperiksa: **${diperiksa}**; role baru diberikan: **${ditambahkan}**.`);
}
// !setxp memakai TOTAL XP kumulatif, bukan XP pada level saat ini.
const OWNER_COMMANDS = {
    addxp: cmdAddXp, removexp: cmdRemoveXp, setxp: cmdSetXp,
    setlevel: cmdSetLevel, addlevel: cmdAddLevel, resetlevel: cmdResetLevel,
    setmenit: cmdSetMenit, givereward: cmdGiveReward, reloadroles: cmdReloadRoles
};

const PERINTAH = {
    rank: cmdRank,
    level: cmdRank,
    top: cmdTop,
    leaderboard: cmdTop,
    rewards: cmdRewards,
    hadiah: cmdRewards,
    menu: cmdMenu
};

const cooldown = new Map();

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;


    const [kata, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (kata || '').toLowerCase();
    const isOwnerCommand = Object.hasOwn(OWNER_COMMANDS, cmd);
    if (!isOwnerCommand && !Object.hasOwn(PERINTAH, cmd)) return;
    if (isOwnerCommand && !pemilik(message)) {
        return message.reply({ embeds: [embedPesan(WARNA.merah, `${EMOJI.cross} Command ini hanya bisa digunakan owner bot.`)], allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    const terakhir = cooldown.get(message.author.id) ?? 0;
    if (Date.now() - terakhir < COOLDOWN_PERINTAH_MS) return;
    cooldown.set(message.author.id, Date.now());
    if (cooldown.size > 1000) cooldown.clear();

    try {
        await (isOwnerCommand ? OWNER_COMMANDS[cmd] : PERINTAH[cmd])(message, args);
    } catch (e) {
        console.log(`[ERROR ${PREFIX}${cmd}]`, e.message);
        await message.reply({
            embeds: [embedPesan(WARNA.merah, `${EMOJI.cross} Terjadi kesalahan. Coba lagi nanti.`)],
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
    }
});

// ----------------------------------------------------------------------------
// SIAP & PENUTUPAN
// ----------------------------------------------------------------------------
client.once(Events.ClientReady, (c) => {
    console.log(`Bot aktif sebagai ${c.user.tag} di ${c.guilds.cache.size} server.`);
    c.user.setPresence({ activities: [{ name: `${PREFIX}menu ${TITIK} voice leveling` }] });
    setInterval(prosesTick, INTERVAL_MS);
});

client.on(Events.Error, (e) => console.log('[CLIENT ERROR]', e.message));

function tutup() {
    console.log('\nMenyimpan data lalu menutup bot...');
    simpanData();
    client.destroy();
    process.exit(0);
}
process.on('SIGINT', tutup);
process.on('SIGTERM', tutup);
process.on('unhandledRejection', (e) => console.log('[UNHANDLED]', e?.message || e));
process.on('uncaughtException', (e) => console.log('[UNCAUGHT]', e?.message || e));

// ----------------------------------------------------------------------------
// MULAI
// ----------------------------------------------------------------------------
if (!TOKEN) {
    console.error('TOKEN belum diisi. Set environment variable DISCORD_TOKEN sebelum menjalankan bot.');
    process.exit(1);
}

data = muatData();
client.login(TOKEN).catch((e) => {
    console.error('Gagal login:', e.message);
    process.exit(1);
});