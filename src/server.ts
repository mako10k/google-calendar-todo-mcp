import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { OAuth2Client } from "google-auth-library";
import type { calendar_v3, tasks_v1 } from "googleapis";
import { z, ZodError, ZodIssue, ZodObject } from "zod";

import { authorize, getCalendarClient, getTasksClient } from "./googleClient.js";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const propertyFilterRegex = /^[^=]+=[^=]+$/;
const propertyFilterSchema = z.string().regex(propertyFilterRegex, "Must be in key=value format");

const attendeeSchema = z.object({
  email: z.string().email(),
  optional: z.boolean().optional(),
  displayName: z.string().optional(),
  responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
  comment: z.string().optional(),
  additionalGuests: z.number().int().min(0).optional()
});

const reminderOverrideSchema = z.object({
  method: z.enum(["email", "popup"]).optional(),
  minutes: z.number().int().min(0)
});

const remindersSchema = z.object({
  useDefault: z.boolean().optional(),
  overrides: reminderOverrideSchema.array().min(1).optional()
});

const extendedPropertiesSchema = z
  .object({
    private: z.record(z.string()).optional(),
    shared: z.record(z.string()).optional()
  })
  .optional();

const attachmentsSchema = z
  .array(
    z.object({
      fileUrl: z.string().url(),
      title: z.string().optional(),
      mimeType: z.string().optional(),
      iconLink: z.string().url().optional(),
      fileId: z.string().optional()
    })
  )
  .optional();

const sourceSchema = z
  .object({
    title: z.string(),
    url: z.string().url()
  })
  .optional();

const conferenceDataSchema = z
  .custom<calendar_v3.Schema$ConferenceData>((value) => typeof value === "object" && value !== null, {
    message: "conferenceData must be an object"
  })
  .optional();

const commonEventFieldsSchema = z.object({
  description: z.string().optional(),
  location: z.string().optional(),
  colorId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  attendees: attendeeSchema.array().optional(),
  reminders: remindersSchema.optional(),
  conferenceData: conferenceDataSchema,
  extendedProperties: extendedPropertiesSchema,
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  anyoneCanAddSelf: z.boolean().optional(),
  attachments: attachmentsSchema,
  source: sourceSchema
});

type CommonEventFields = z.infer<typeof commonEventFieldsSchema>;
type RemindersInput = z.infer<typeof remindersSchema>;
type AttendeeInput = z.infer<typeof attendeeSchema>;
type ExtendedPropertiesInput = z.infer<typeof extendedPropertiesSchema>;

function mapEvent(event: calendar_v3.Schema$Event) {
  return {
    id: event.id ?? null,
    status: event.status ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.start ?? null,
    end: event.end ?? null,
    recurrence: event.recurrence ?? null,
    recurringEventId: event.recurringEventId ?? null,
    originalStartTime: event.originalStartTime ?? null,
    creator: event.creator ?? null,
    organizer: event.organizer ?? null,
    attendees: event.attendees ?? null,
    htmlLink: event.htmlLink ?? null,
    hangoutLink: event.hangoutLink ?? null,
    conferenceData: event.conferenceData ?? null,
    attachments: event.attachments ?? null,
    transparency: event.transparency ?? null,
    visibility: event.visibility ?? null,
    colorId: event.colorId ?? null,
    reminders: event.reminders ?? null,
    updated: event.updated ?? null,
    created: event.created ?? null
  };
}

function mapAttendeesForRequest(attendees?: AttendeeInput[]) {
  return attendees?.map((attendee) => ({
    email: attendee.email,
    optional: attendee.optional,
    displayName: attendee.displayName,
    responseStatus: attendee.responseStatus,
    comment: attendee.comment,
    additionalGuests: attendee.additionalGuests
  }));
}

function mapReminders(reminders?: RemindersInput) {
  if (!reminders) {
    return undefined;
  }

  const overrides = reminders.overrides?.map((override) => ({
    method: override.method ?? "popup",
    minutes: override.minutes
  }));

  const mapped: NonNullable<calendar_v3.Schema$Event["reminders"]> = {};

  if (reminders.useDefault !== undefined) {
    mapped.useDefault = reminders.useDefault;
  }

  if (overrides && overrides.length > 0) {
    mapped.overrides = overrides;
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapExtendedProperties(extendedProperties?: ExtendedPropertiesInput) {
  if (!extendedProperties) {
    return undefined;
  }

  const hasPrivate = extendedProperties.private && Object.keys(extendedProperties.private).length > 0;
  const hasShared = extendedProperties.shared && Object.keys(extendedProperties.shared).length > 0;

  if (!hasPrivate && !hasShared) {
    return undefined;
  }

  return {
    private: hasPrivate ? extendedProperties.private : undefined,
    shared: hasShared ? extendedProperties.shared : undefined
  };
}

function applyCommonEventFields(target: calendar_v3.Schema$Event, input: CommonEventFields) {
  if (input.description !== undefined) target.description = input.description;
  if (input.location !== undefined) target.location = input.location;
  if (input.colorId !== undefined) target.colorId = input.colorId;
  if (input.recurrence !== undefined) target.recurrence = input.recurrence;
  if (input.transparency !== undefined) target.transparency = input.transparency;
  if (input.visibility !== undefined) target.visibility = input.visibility;
  if (input.attendees !== undefined) target.attendees = mapAttendeesForRequest(input.attendees);
  if (input.reminders !== undefined) target.reminders = mapReminders(input.reminders);
  if (input.conferenceData !== undefined) target.conferenceData = input.conferenceData;
  if (input.extendedProperties !== undefined) target.extendedProperties = mapExtendedProperties(input.extendedProperties);
  if (input.guestsCanInviteOthers !== undefined) target.guestsCanInviteOthers = input.guestsCanInviteOthers;
  if (input.guestsCanModify !== undefined) target.guestsCanModify = input.guestsCanModify;
  if (input.guestsCanSeeOtherGuests !== undefined) target.guestsCanSeeOtherGuests = input.guestsCanSeeOtherGuests;
  if (input.anyoneCanAddSelf !== undefined) target.anyoneCanAddSelf = input.anyoneCanAddSelf;
  if (input.attachments !== undefined) target.attachments = input.attachments;
  if (input.source !== undefined) target.source = input.source;
}

function toJsonContent(data: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(data, null, 2) }];
}

function toGoogleDate(value: string, timeZone?: string) {
  if (DATE_ONLY_REGEX.test(value)) {
    return { date: value };
  }
  return timeZone ? { dateTime: value, timeZone } : { dateTime: value };
}

type ToolResult = { content: ReturnType<typeof toJsonContent> };

export class GoogleCalendarTodoMcpServer {
  private readonly server: McpServer;
  private authClient?: OAuth2Client;
  private calendar?: calendar_v3.Calendar;
  private tasks?: tasks_v1.Tasks;

  constructor(private readonly version: string) {
    this.server = new McpServer({
      name: "google-calendar-todo",
      version
    });
  }

  async initialize(): Promise<void> {
    this.authClient = await authorize();
    this.calendar = getCalendarClient(this.authClient);
    this.tasks = getTasksClient(this.authClient);
    this.registerCalendarTools();
    this.registerTaskTools();
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  private ensureCalendar(): calendar_v3.Calendar {
    if (!this.calendar) {
      throw new McpError(ErrorCode.InternalError, "Google Calendar client is not initialized");
    }
    return this.calendar;
  }

  private ensureTasks(): tasks_v1.Tasks {
    if (!this.tasks) {
      throw new McpError(ErrorCode.InternalError, "Google Tasks client is not initialized");
    }
    return this.tasks;
  }

  private registerCalendarTools(): void {
    this.registerTool(
      "list-calendars",
      "List all calendars available to the authenticated user.",
      z.object({}),
      async () => {
        const calendar = this.ensureCalendar();
        const response = await calendar.calendarList.list();
        const calendars = (response.data.items ?? []).map((item: calendar_v3.Schema$CalendarListEntry) => ({
          id: item.id,
          summary: item.summary,
          description: item.description ?? null,
          timeZone: item.timeZone ?? null,
          primary: Boolean(item.primary),
          accessRole: item.accessRole ?? null
        }));
        return { content: toJsonContent({ calendars }) };
      }
    );

    const listEventsInput = z.object({
      calendarId: z.string().default("primary"),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      maxResults: z.number().int().min(1).max(2500).optional(),
      query: z.string().optional(),
      singleEvents: z.boolean().optional(),
      orderBy: z.enum(["startTime", "updated"]).optional(),
      showDeleted: z.boolean().optional(),
      timeZone: z.string().optional(),
      pageToken: z.string().optional(),
      syncToken: z.string().optional(),
      privateExtendedProperty: propertyFilterSchema.array().optional(),
      sharedExtendedProperty: propertyFilterSchema.array().optional()
    });

    this.registerTool(
      "list-events",
      "List events from a calendar with optional filtering and pagination.",
      listEventsInput,
      async (input) => {
        const calendar = this.ensureCalendar();
        const response = await calendar.events.list({
          calendarId: input.calendarId,
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          maxResults: input.maxResults,
          q: input.query,
          singleEvents: input.singleEvents,
          orderBy: input.orderBy,
          showDeleted: input.showDeleted,
          timeZone: input.timeZone,
          pageToken: input.pageToken,
          syncToken: input.syncToken,
          privateExtendedProperty: input.privateExtendedProperty,
          sharedExtendedProperty: input.sharedExtendedProperty
        });

        const events = (response.data.items ?? []).map(mapEvent);

        return {
          content: toJsonContent({
            events,
            nextPageToken: response.data.nextPageToken ?? null,
            nextSyncToken: response.data.nextSyncToken ?? null
          })
        };
      }
    );

    const searchEventsInput = z.object({
      calendarIds: z.array(z.string()).min(1).default(["primary"]),
      query: z.string().min(1),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      maxResultsPerCalendar: z.number().int().min(1).max(2500).optional(),
      timeZone: z.string().optional(),
      orderBy: z.enum(["startTime", "updated"]).optional(),
      showDeleted: z.boolean().optional(),
      singleEvents: z.boolean().optional(),
      privateExtendedProperty: propertyFilterSchema.array().optional(),
      sharedExtendedProperty: propertyFilterSchema.array().optional()
    });

    this.registerTool(
      "search-events",
      "Search events across one or more calendars with advanced filters.",
      searchEventsInput,
      async (input) => {
        const calendar = this.ensureCalendar();
        const results = [] as Array<{
          calendarId: string;
          events: ReturnType<typeof mapEvent>[];
          nextPageToken: string | null;
        }>;

        for (const calendarId of input.calendarIds) {
          const response = await calendar.events.list({
            calendarId,
            q: input.query,
            timeMin: input.timeMin,
            timeMax: input.timeMax,
            maxResults: input.maxResultsPerCalendar,
            timeZone: input.timeZone,
            orderBy: input.orderBy,
            showDeleted: input.showDeleted,
            singleEvents: input.singleEvents,
            privateExtendedProperty: input.privateExtendedProperty,
            sharedExtendedProperty: input.sharedExtendedProperty
          });

          results.push({
            calendarId,
            events: (response.data.items ?? []).map(mapEvent),
            nextPageToken: response.data.nextPageToken ?? null
          });
        }

        const totalEvents = results.reduce((sum, entry) => sum + entry.events.length, 0);

        return {
          content: toJsonContent({
            query: input.query,
            totalEvents,
            calendars: results
          })
        };
      }
    );

    const createEventInput = z
      .object({
        calendarId: z.string().default("primary"),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        timeZone: z.string().optional(),
        eventId: z.string().optional(),
        sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
      })
      .merge(commonEventFieldsSchema);

    this.registerTool(
      "create-event",
      "Create a new calendar event, including support for recurrence and advanced options.",
      createEventInput,
      async (input) => {
        const calendar = this.ensureCalendar();

        const requestBody: calendar_v3.Schema$Event = {
          summary: input.summary,
          start: toGoogleDate(input.start, input.timeZone),
          end: toGoogleDate(input.end, input.timeZone)
        };

        if (input.description !== undefined) requestBody.description = input.description;
        if (input.location !== undefined) requestBody.location = input.location;
        if (input.eventId) requestBody.id = input.eventId;

        applyCommonEventFields(requestBody, input);

        const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;

        const created = await calendar.events.insert({
          calendarId: input.calendarId,
          requestBody,
          sendUpdates: input.sendUpdates,
          supportsAttachments: hasAttachments || undefined,
          conferenceDataVersion: input.conferenceData ? 1 : undefined
        });

        return { content: toJsonContent({ event: created.data }) };
      }
    );

    const updateEventInput = z
      .object({
        calendarId: z.string().default("primary"),
        eventId: z.string(),
        summary: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        timeZone: z.string().optional(),
        sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
      })
      .merge(commonEventFieldsSchema);

    this.registerTool(
      "update-event",
      "Update an existing calendar event or recurring series.",
      updateEventInput,
      async (input) => {
        const calendar = this.ensureCalendar();

        const requestBody: calendar_v3.Schema$Event = {};
        if (input.summary !== undefined) requestBody.summary = input.summary;
        if (input.start !== undefined) requestBody.start = toGoogleDate(input.start, input.timeZone);
        if (input.end !== undefined) requestBody.end = toGoogleDate(input.end, input.timeZone);

        applyCommonEventFields(requestBody, input);

        const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;

        const updated = await calendar.events.patch({
          calendarId: input.calendarId,
          eventId: input.eventId,
          requestBody,
          sendUpdates: input.sendUpdates,
          supportsAttachments: hasAttachments || undefined,
          conferenceDataVersion: input.conferenceData ? 1 : undefined
        });

        return { content: toJsonContent({ event: updated.data }) };
      }
    );

    const listEventInstancesInput = z.object({
      calendarId: z.string().default("primary"),
      recurringEventId: z.string(),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      maxResults: z.number().int().min(1).max(2500).optional(),
      pageToken: z.string().optional(),
      showDeleted: z.boolean().optional(),
      timeZone: z.string().optional()
    });

    this.registerTool(
      "list-event-instances",
      "List all instances of a recurring event.",
      listEventInstancesInput,
      async (input) => {
        const calendar = this.ensureCalendar();
        const response = await calendar.events.instances({
          calendarId: input.calendarId,
          eventId: input.recurringEventId,
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          maxResults: input.maxResults,
          pageToken: input.pageToken,
          showDeleted: input.showDeleted,
          timeZone: input.timeZone
        });

        const instances = (response.data.items ?? []).map(mapEvent);

        return {
          content: toJsonContent({
            instances,
            nextPageToken: response.data.nextPageToken ?? null
          })
        };
      }
    );

    const updateEventInstanceInput = z
      .object({
        calendarId: z.string().default("primary"),
        instanceId: z.string(),
        summary: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        timeZone: z.string().optional(),
        sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
      })
      .merge(commonEventFieldsSchema);

    this.registerTool(
      "update-event-instance",
      "Update a single occurrence of a recurring event.",
      updateEventInstanceInput,
      async (input) => {
        const calendar = this.ensureCalendar();

        const requestBody: calendar_v3.Schema$Event = {};
        if (input.summary !== undefined) requestBody.summary = input.summary;
        if (input.start !== undefined) requestBody.start = toGoogleDate(input.start, input.timeZone);
        if (input.end !== undefined) requestBody.end = toGoogleDate(input.end, input.timeZone);

        applyCommonEventFields(requestBody, input);

        const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;

        const updated = await calendar.events.patch({
          calendarId: input.calendarId,
          eventId: input.instanceId,
          requestBody,
          sendUpdates: input.sendUpdates,
          supportsAttachments: hasAttachments || undefined,
          conferenceDataVersion: input.conferenceData ? 1 : undefined
        });

        return { content: toJsonContent({ event: updated.data }) };
      }
    );

    const deleteEventInput = z.object({
      calendarId: z.string().default("primary"),
      eventId: z.string(),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
    });

    this.registerTool(
      "delete-event",
      "Delete a calendar event or recurring series.",
      deleteEventInput,
      async (input) => {
        const calendar = this.ensureCalendar();
        await calendar.events.delete({
          calendarId: input.calendarId,
          eventId: input.eventId,
          sendUpdates: input.sendUpdates
        });
        return { content: toJsonContent({ success: true }) };
      }
    );

    const deleteEventInstanceInput = z.object({
      calendarId: z.string().default("primary"),
      instanceId: z.string(),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
    });

    this.registerTool(
      "delete-event-instance",
      "Delete a single occurrence of a recurring event.",
      deleteEventInstanceInput,
      async (input) => {
        const calendar = this.ensureCalendar();
        await calendar.events.delete({
          calendarId: input.calendarId,
          eventId: input.instanceId,
          sendUpdates: input.sendUpdates
        });
        return { content: toJsonContent({ success: true }) };
      }
    );
  }

  private registerTaskTools(): void {
    this.registerTool(
      "list-tasklists",
      "List all Google Task lists available to the authenticated user.",
      z.object({}),
      async () => {
        const tasks = this.ensureTasks();
        const response = await tasks.tasklists.list({ maxResults: 100 });
        const tasklists = (response.data.items ?? []).map((item: tasks_v1.Schema$TaskList) => ({
          id: item.id,
          title: item.title,
          updated: item.updated
        }));
        return { content: toJsonContent({ tasklists, nextPageToken: response.data.nextPageToken ?? null }) };
      }
    );

    const listTasksInput = z.object({
      tasklistId: z.string().default("@default"),
      showCompleted: z.boolean().optional(),
      showDeleted: z.boolean().optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
      dueMin: z.string().optional(),
      dueMax: z.string().optional()
    });

    this.registerTool(
      "list-tasks",
      "List tasks from a task list.",
      listTasksInput,
      async (input) => {
        const tasks = this.ensureTasks();
        const response = await tasks.tasks.list({
          tasklist: input.tasklistId,
          showCompleted: input.showCompleted,
          showDeleted: input.showDeleted,
          maxResults: input.maxResults,
          dueMin: input.dueMin,
          dueMax: input.dueMax
        });

  const taskItems = (response.data.items ?? []).map((task: tasks_v1.Schema$Task) => ({
          id: task.id,
          title: task.title,
          notes: task.notes ?? null,
          status: task.status,
          due: task.due ?? null,
          completed: task.completed ?? null,
          updated: task.updated
        }));

        return { content: toJsonContent({ tasks: taskItems, nextPageToken: response.data.nextPageToken ?? null }) };
      }
    );

    const createTaskInput = z.object({
      tasklistId: z.string().default("@default"),
      title: z.string(),
      notes: z.string().optional(),
      due: z.string().optional()
    });

    this.registerTool(
      "create-task",
      "Create a new task in the specified task list.",
      createTaskInput,
      async (input) => {
        const tasks = this.ensureTasks();
        const created = await tasks.tasks.insert({
          tasklist: input.tasklistId,
          requestBody: {
            title: input.title,
            notes: input.notes,
            due: input.due
          }
        });

        return { content: toJsonContent({ task: created.data }) };
      }
    );

    const updateTaskInput = z.object({
      tasklistId: z.string().default("@default"),
      taskId: z.string(),
      title: z.string().optional(),
      notes: z.string().optional(),
      due: z.string().optional(),
      status: z.enum(["needsAction", "completed"]).optional()
    });

    this.registerTool(
      "update-task",
      "Update a task in the specified task list.",
      updateTaskInput,
      async (input) => {
        const tasks = this.ensureTasks();

        const requestBody: tasks_v1.Schema$Task = {};
        if (input.title !== undefined) requestBody.title = input.title;
        if (input.notes !== undefined) requestBody.notes = input.notes;
        if (input.due !== undefined) requestBody.due = input.due;
        if (input.status !== undefined) {
          requestBody.status = input.status;
          if (input.status === "completed") {
            requestBody.completed = new Date().toISOString();
          }
        }

        const updated = await tasks.tasks.patch({
          tasklist: input.tasklistId,
          task: input.taskId,
          requestBody
        });

        return { content: toJsonContent({ task: updated.data }) };
      }
    );

    const completeTaskInput = z.object({
      tasklistId: z.string().default("@default"),
      taskId: z.string()
    });

    this.registerTool(
      "complete-task",
      "Mark a task as completed.",
      completeTaskInput,
      async (input) => {
        const tasks = this.ensureTasks();
        const completedAt = new Date().toISOString();
        const updated = await tasks.tasks.patch({
          tasklist: input.tasklistId,
          task: input.taskId,
          requestBody: {
            status: "completed",
            completed: completedAt
          }
        });
        return { content: toJsonContent({ task: updated.data }) };
      }
    );

    const deleteTaskInput = z.object({
      tasklistId: z.string().default("@default"),
      taskId: z.string()
    });

    this.registerTool(
      "delete-task",
      "Delete a task from the specified task list.",
      deleteTaskInput,
      async (input) => {
        const tasks = this.ensureTasks();
        await tasks.tasks.delete({
          tasklist: input.tasklistId,
          task: input.taskId
        });
        return { content: toJsonContent({ success: true }) };
      }
    );
  }

  private registerTool<T extends ZodObject<any, any, any, any, any>>(
    name: string,
    description: string,
    schema: T,
    executor: (input: z.infer<T>) => Promise<ToolResult>
  ): void {
    this.server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape
      },
      async (args: unknown) => {
        try {
          const parsed = schema.parse(args ?? {});
          return await executor(parsed);
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          if (error instanceof ZodError) {
            const message = error.issues.map((issue: ZodIssue) => issue.message).join("; ");
            throw new McpError(ErrorCode.InvalidParams, message);
          }
          if (error && typeof error === "object" && "message" in error) {
            throw new McpError(ErrorCode.InternalError, String((error as Error).message));
          }
          throw new McpError(ErrorCode.InternalError, "Unexpected error executing tool");
        }
      }
    );
  }
}

export async function startServer(version: string): Promise<void> {
  const server = new GoogleCalendarTodoMcpServer(version);
  await server.initialize();
  await server.start();
}
