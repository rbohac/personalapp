using Bo.Api.Ai;
using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Capture;
using Bo.Api.Data;
using Bo.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddBoDatabase(builder.Configuration);
builder.Services.AddBoAuth(builder.Configuration);
// The areas folder is loaded once; a malformed area.json stops startup.
builder.Services.AddSingleton(AreaCatalog.Load(AreaCatalog.FindDirectory(builder.Configuration, builder.Environment.ContentRootPath)));
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.AddSingleton<AiUsageStore>();
builder.Services.AddHostedService<AiLogRetention>();
// The model the capture parser talks to. A second provider is another
// IModelClient implementation chosen here by Capture:Provider.
builder.Services.AddSingleton<IModelClient>(_ => (builder.Configuration["Capture:Provider"] ?? "anthropic") switch
{
    "anthropic" => new AnthropicModelClient(
        builder.Configuration["Capture:AnthropicApiKey"] is { Length: > 0 } k ? k : Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY"),
        builder.Configuration["Capture:Model"] is { Length: > 0 } m ? m : "claude-haiku-5-5"),
    var other => throw new InvalidOperationException($"Capture:Provider \"{other}\" has no client yet."),
});
builder.Services.AddSingleton<CaptureParser>();
// Schedules and their nudges (server pushes through Expo).
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Bo.Api.Schedules.ScheduleStore>();
builder.Services.AddHttpClient<Bo.Api.Schedules.ExpoPush>();
builder.Services.AddSingleton<Bo.Api.Goals.GoalStore>();
builder.Services.AddSingleton<Bo.Api.Ask.AskService>();
builder.Services.AddHostedService<Bo.Api.Schedules.Nudger>();

var app = builder.Build();

// Migrations run before the app takes traffic. Fly's health check waits on
// /healthz, so a failed migration keeps the old machine serving.
Migrator.Run(app.Services.GetRequiredService<Db>().ConnectionString, app.Logger);

app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<Bo.Api.Sync.Idempotency>();

// The contract the mobile app's client is generated from (npm run api:types).
app.MapOpenApi();

app.MapGet("/healthz", () => Results.Ok(new { ok = true })).ExcludeFromDescription();

app.MapAuthEndpoints();
app.MapTaskEndpoints();
app.MapDeviceEndpoints();
app.MapAreaEndpoints();
app.MapEntryEndpoints();
app.MapCaptureEndpoints();
app.MapAiUsageEndpoints();
app.MapVocabularyEndpoints();
app.MapScheduleEndpoints();
app.MapGoalEndpoints();
app.MapAskTrendsEndpoints();
app.MapChecklistEndpoints();

app.Run();
