using System.Collections.Generic;
using System.IO;
using YGOSharp.Network.Enums;

namespace YGOSharp.Network
{
    // Fausse connexion : les paquets que le bot « envoie » au serveur sont gardés pour DuelWeb.
    public class YGOClient
    {
        public readonly List<byte[]> Sent = new List<byte[]>();
        public bool Closed { get; private set; }

        public void Send(byte[] data) { Sent.Add(data); }

        public void Send(BinaryWriter writer) { Send(((MemoryStream)writer.BaseStream).ToArray()); }

        public void Send(CtosMessage message) { Send(new[] { (byte)message }); }

        public void Send(CtosMessage message, byte value)
        {
            using (BinaryWriter writer = new BinaryWriter(new MemoryStream()))
            {
                writer.Write((byte)message);
                writer.Write(value);
                Send(writer);
            }
        }

        public void Send(CtosMessage message, int value)
        {
            using (BinaryWriter writer = new BinaryWriter(new MemoryStream()))
            {
                writer.Write((byte)message);
                writer.Write(value);
                Send(writer);
            }
        }

        public void Send(CtosMessage message, long value)
        {
            using (BinaryWriter writer = new BinaryWriter(new MemoryStream()))
            {
                writer.Write((byte)message);
                writer.Write(value);
                Send(writer);
            }
        }

        public void Close() { Closed = true; }
    }
}
