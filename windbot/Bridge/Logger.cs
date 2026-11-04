using System;

namespace WindBot
{
    // Remplace Logger.cs : pas de couleurs de console dans le navigateur.
    public static class Logger
    {
        public static bool Verbose = false;

        public static void WriteLine(string message)
        {
            if (Verbose)
                Console.WriteLine("[WindBot] " + message);
        }

        public static void DebugWriteLine(string message)
        {
        }

        public static void WriteErrorLine(string message)
        {
            Console.Error.WriteLine("[WindBot] " + message);
        }
    }
}
