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
builder.Services.AddSingleton<CaptureParser>();

var app = builder.Build();

// Migrations run before the app takes traffic. Fly's health check waits on
// /healthz, so a failed migration keeps the old machine serving.
Migrator.Run(app.Services.GetRequiredService<Db>().ConnectionString, app.Logger);

app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();

// The contract the mobile app's client is generated from (npm run api:types).
app.MapOpenApi();

app.MapGet("/healthz", () => Results.Ok(new { ok = true })).ExcludeFromDescription();

app.MapAuthEndpoints();
app.MapTaskEndpoints();
app.MapDeviceEndpoints();
app.MapAreaEndpoints();
app.MapEntryEndpoints();
app.MapCaptureEndpoints();

app.Run();
