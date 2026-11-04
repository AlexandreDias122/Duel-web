using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Text;

namespace YGOSharp.OCGWrapper
{
    // Remplace NamedCardsManager/CardsManager (SQLite) : les cartes viennent de la base déjà chargée par DuelWeb.
    public static class NamedCardsManager
    {
        private static IDictionary<long, NamedCard> _cards = new Dictionary<long, NamedCard>();

        public static void SetThreadSafe()
        {
        }

        /// <summary>
        /// Format (petit-boutiste) : u32 nombre, puis par carte
        /// i32 id, i32 ot, i32 alias, i64 setcode, i64 type, i64 level, i64 race, i64 attribute, i32 atk, i32 def, u16 + UTF-8 nom.
        /// </summary>
        public static void LoadFromBytes(byte[] data)
        {
            Dictionary<long, NamedCard> cards = new Dictionary<long, NamedCard>();
            using (BinaryReader reader = new BinaryReader(new MemoryStream(data)))
            {
                int count = reader.ReadInt32();
                ArrayRecord record = new ArrayRecord();
                for (int i = 0; i < count; i++)
                {
                    int id = reader.ReadInt32();
                    int ot = reader.ReadInt32();
                    int alias = reader.ReadInt32();
                    long setcode = reader.ReadInt64();
                    long type = reader.ReadInt64();
                    long level = reader.ReadInt64();
                    long race = reader.ReadInt64();
                    long attribute = reader.ReadInt64();
                    int atk = reader.ReadInt32();
                    int def = reader.ReadInt32();
                    int len = reader.ReadUInt16();
                    string name = Encoding.UTF8.GetString(reader.ReadBytes(len));
                    record.Values = new object[] { id, ot, alias, setcode, type, level, race, attribute, atk, def, name, "" };
                    NamedCard card = new NamedCard(record);
                    cards[card.Id] = card;
                }
            }
            _cards = cards;
        }

        internal static NamedCard GetCard(long id)
        {
            NamedCard card;
            return _cards.TryGetValue(id, out card) ? card : null;
        }

        public static IList<NamedCard> GetAllCards()
        {
            return _cards.Values.ToList();
        }
    }

    internal static class CardsManager
    {
        internal static Card GetCard(int id)
        {
            return NamedCardsManager.GetCard(id);
        }
    }

    /// <summary>Ligne de « base de données » en mémoire, lue par les constructeurs de Card et NamedCard.</summary>
    internal sealed class ArrayRecord : IDataRecord
    {
        public object[] Values = new object[0];

        public object this[int i] { get { return Values[i]; } }
        public object this[string name] { get { throw new NotSupportedException(); } }
        public int FieldCount { get { return Values.Length; } }
        public bool GetBoolean(int i) { return Convert.ToBoolean(Values[i]); }
        public byte GetByte(int i) { return Convert.ToByte(Values[i]); }
        public long GetBytes(int i, long fieldOffset, byte[] buffer, int bufferoffset, int length) { throw new NotSupportedException(); }
        public char GetChar(int i) { return Convert.ToChar(Values[i]); }
        public long GetChars(int i, long fieldoffset, char[] buffer, int bufferoffset, int length) { throw new NotSupportedException(); }
        public IDataReader GetData(int i) { throw new NotSupportedException(); }
        public string GetDataTypeName(int i) { return Values[i].GetType().Name; }
        public DateTime GetDateTime(int i) { throw new NotSupportedException(); }
        public decimal GetDecimal(int i) { return Convert.ToDecimal(Values[i]); }
        public double GetDouble(int i) { return Convert.ToDouble(Values[i]); }
        public Type GetFieldType(int i) { return Values[i].GetType(); }
        public float GetFloat(int i) { return Convert.ToSingle(Values[i]); }
        public Guid GetGuid(int i) { throw new NotSupportedException(); }
        public short GetInt16(int i) { return Convert.ToInt16(Values[i]); }
        public int GetInt32(int i) { return Convert.ToInt32(Values[i]); }
        public long GetInt64(int i) { return Convert.ToInt64(Values[i]); }
        public string GetName(int i) { return i.ToString(); }
        public int GetOrdinal(string name) { throw new NotSupportedException(); }
        public string GetString(int i) { return Convert.ToString(Values[i]); }
        public object GetValue(int i) { return Values[i]; }
        public int GetValues(object[] values) { Array.Copy(Values, values, Math.Min(values.Length, Values.Length)); return Math.Min(values.Length, Values.Length); }
        public bool IsDBNull(int i) { return Values[i] == null; }
    }
}
