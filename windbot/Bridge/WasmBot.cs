using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using WindBot.Game;
using YGOSharp.Network.Enums;
using YGOSharp.OCGWrapper;

namespace WindBot
{
    /// <summary>
    /// Point d'entrée appelé depuis JavaScript. Chaque bot reçoit les paquets qu'un serveur EDOPro lui
    /// enverrait (STOC_GAME_MSG + message du moteur) et renvoie sa réponse (CTOS_RESPONSE).
    /// </summary>
    public static partial class WasmBot
    {
        private static readonly Dictionary<int, GameClient> Bots = new Dictionary<int, GameClient>();
        private static int _next = 1;

        /// <summary>Charge les cartes et les executors. Renvoie un texte d'erreur, vide si tout va bien.</summary>
        [JSExport]
        public static string Init(byte[] cards)
        {
            try
            {
                Program.Rand = new Random();
                ExtractAssets();
                NamedCardsManager.LoadFromBytes(cards);
                DecksManager.Init();
                return "";
            }
            catch (Exception ex)
            {
                return ex.ToString();
            }
        }

        // Decks (.ydk) et dialogues sont lus sur « disque » par le code d'origine : on les dépose dans le système de fichiers virtuel.
        private static void ExtractAssets()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string name in asm.GetManifestResourceNames())
            {
                string path = Path.Combine(Program.AssetPath, name);
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (Stream input = asm.GetManifestResourceStream(name))
                using (FileStream output = File.Create(path))
                    input.CopyTo(output);
            }
        }

        /// <summary>Crée un bot pour le deck WindBot donné. Renvoie son numéro, ou 0 si le deck est introuvable.</summary>
        [JSExport]
        public static int Create(string deck, string dialog)
        {
            try
            {
                GameClient client = new GameClient(deck, dialog);
                if (client.Behavior.Deck == null)
                    return 0;
                int id = _next++;
                Bots[id] = client;
                return id;
            }
            catch (Exception ex)
            {
                Logger.WriteErrorLine("WindBot: " + ex);
                return 0;
            }
        }

        /// <summary>Deck du bot : codes du Main Deck, « | », codes de l'Extra Deck.</summary>
        [JSExport]
        public static string DeckOf(int id)
        {
            GameClient client;
            if (!Bots.TryGetValue(id, out client))
                return "";
            Deck deck = client.Behavior.Deck;
            return string.Join(",", deck.Cards) + "|" + string.Join(",", deck.ExtraCards);
        }

        /// <summary>
        /// Transmet un paquet au bot. Premier octet du résultat : 0 pas de réponse, 1 réponse (octets qui suivent),
        /// 2 erreur dans WindBot, 3 abandon.
        /// </summary>
        [JSExport]
        public static byte[] Feed(int id, byte[] packet)
        {
            GameClient client;
            if (!Bots.TryGetValue(id, out client))
                return new byte[] { 2 };
            client.Connection.Sent.Clear();
            try
            {
                using (BinaryReader reader = new BinaryReader(new MemoryStream(packet)))
                    client.Behavior.OnPacket(reader);
            }
            catch (Exception ex)
            {
                Logger.WriteErrorLine("WindBot: " + ex.GetType().Name + ": " + ex.Message + "\n" + ex.StackTrace);
                return new byte[] { 2 };
            }
            if (client.Surrendered)
                return new byte[] { 3 };
            foreach (byte[] sent in client.Connection.Sent)
            {
                if (sent.Length > 0 && sent[0] == (byte)CtosMessage.Response)
                {
                    byte[] result = new byte[sent.Length];
                    result[0] = 1;
                    Array.Copy(sent, 1, result, 1, sent.Length - 1);
                    return result;
                }
            }
            return new byte[] { 0 };
        }

        /// <summary>Répliques du bot depuis le dernier appel, séparées par des sauts de ligne.</summary>
        [JSExport]
        public static string TakeChat(int id)
        {
            GameClient client;
            if (!Bots.TryGetValue(id, out client) || client.Chats.Count == 0)
                return "";
            string text = string.Join("\n", client.Chats);
            client.Chats.Clear();
            return text;
        }

        [JSExport]
        public static void Destroy(int id)
        {
            Bots.Remove(id);
        }
    }
}
