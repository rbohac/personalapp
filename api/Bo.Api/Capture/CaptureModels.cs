namespace Bo.Api.Capture;

/// <summary>What the owner typed or said. <c>TimeZone</c> is the phone's IANA zone, so "this morning" means their morning.</summary>
public record CaptureRequest(string Text, string? TimeZone = null, string Source = "typed");

/// <summary>
/// What Bo understood, not yet saved. The app shows each proposal and saves
/// the ones the owner keeps through the ordinary endpoints (POST /entries,
/// POST /tasks), so a capture can never write something nobody looked at.
/// </summary>
public record CaptureResult(Proposal[] Proposals, string Parser, string? Note);

/// <param name="Kind">"entry" or "task".</param>
/// <param name="Problems">Why it can't be saved as is (a missing reading, a value out of range). Empty means ready.</param>
public record Proposal(
    string Kind, string Area, string AreaName, string Icon, DateTime At,
    Dictionary<string, object?> Data, string Summary, TaskProposal? Task, string[] Problems);

public record TaskProposal(string Title, string List, DateTime? DueAt, DateTime? RemindAt);
