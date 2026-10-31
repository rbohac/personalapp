using System.Reflection;
using DbUp;

namespace Bo.Api.Data;

/// <summary>
/// Applies <c>Data/Migrations/*.sql</c> in name order, once each, recording
/// what ran in DbUp's <c>schemaversions</c> table.
///
/// Rules for a new migration: a new file with the next number, never an edit
/// to one that has shipped (it has already run in production and will not run
/// again), and additive where possible so the previous build keeps working
/// against the new schema during a deploy.
/// </summary>
public static class Migrator
{
    public static void Run(string connectionString, ILogger logger)
    {
        var upgrader = DeployChanges.To
            .PostgresqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(Assembly.GetExecutingAssembly(), name => name.EndsWith(".sql"))
            .WithTransactionPerScript()
            .LogToConsole()
            .Build();

        var pending = upgrader.GetScriptsToExecute();
        if (pending.Count == 0)
        {
            logger.LogInformation("Database schema is current.");
            return;
        }

        logger.LogInformation("Applying {Count} migration(s): {Names}", pending.Count, string.Join(", ", pending.Select(s => s.Name)));
        var result = upgrader.PerformUpgrade();
        if (!result.Successful) throw new InvalidOperationException("Database migration failed.", result.Error);
    }
}
