const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const report = {
  embeds: [
    {
      title: "🛰️ NEXUS SENTINEL - GLOBAL PIPELINE AUDIT",
      description: "Synthèse exhaustive de l'état du Nexus. Identifie les goulots d'étranglement (Agents 008, 011, 013, 014, 015) et la dégradation du système de combat.",
      color: 0x3498db, // Light Blue
      fields: [
        { name: "🟢 Noyau (001-006)", value: "STABLE (9.2/10)", inline: true },
        { name: "🔴 Monitoring Gap", value: "Agents 008, 011, 013, 014, 015 SILENCIEUX (>72h)", inline: false },
        { name: "⚠️ Combat Pipeline", value: "DÉGRADÉ (100% FLAT, Reasonings vides)", inline: false },
        { name: "📉 Performance 008", value: "Drawdown PERTE $750.71 (Crash non-isolé)", inline: true }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Nexus Sentinel - Global Pipeline Audit"
      }
    }
  ]
};

async function sendReport() {
  const response = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord API Error: ${response.status} ${error}`);
  }

  console.log("✅ Report sent successfully to Discord!");
}

sendReport().catch(console.error);
