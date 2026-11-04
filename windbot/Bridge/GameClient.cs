using System.Collections.Generic;
using YGOSharp.Network;

namespace WindBot.Game
{
    // Remplace le GameClient d'origine : même interface pour GameBehavior, sans réseau.
    public class GameClient
    {
        public YGOClient Connection { get; private set; }
        public string Username = "WindBot";
        public string Deck;
        public string DeckFile;
        public string Dialog;
        public int Hand;
        public bool Debug;
        public bool _chat = true;

        public readonly List<string> Chats = new List<string>();
        public bool Surrendered { get; private set; }
        public GameBehavior Behavior { get; private set; }

        public GameClient(string deck, string dialog)
        {
            Deck = deck;
            Dialog = dialog;
            Connection = new YGOClient();
            Behavior = new GameBehavior(this);
        }

        public void Chat(string message, bool forced)
        {
            if (!forced && !_chat)
                return;
            Chats.Add(message);
        }

        public void Surrender()
        {
            Surrendered = true;
        }

        public void Log(string message, int type)
        {
            if (type == 0)
                Logger.WriteLine(message);
            else if (type == 2)
                Logger.WriteErrorLine(message);
        }
    }
}
