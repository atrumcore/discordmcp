import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, ForumChannel, ChannelType, ThreadChannel, AnyThreadChannel } from 'discord.js';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Helper function to find a guild by name or ID
async function findGuild(guildIdentifier?: string) {
  if (!guildIdentifier) {
    // If no guild specified and bot is only in one guild, use that
    if (client.guilds.cache.size === 1) {
      return client.guilds.cache.first()!;
    }
    // List available guilds
    const guildList = Array.from(client.guilds.cache.values())
      .map(g => `"${g.name}"`).join(', ');
    throw new Error(`Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`);
  }

  // Try to fetch by ID first
  try {
    const guild = await client.guilds.fetch(guildIdentifier);
    if (guild) return guild;
  } catch {
    // If ID fetch fails, search by name
    const guilds = client.guilds.cache.filter(
      g => g.name.toLowerCase() === guildIdentifier.toLowerCase()
    );
    
    if (guilds.size === 0) {
      const availableGuilds = Array.from(client.guilds.cache.values())
        .map(g => `"${g.name}"`).join(', ');
      throw new Error(`Server "${guildIdentifier}" not found. Available servers: ${availableGuilds}`);
    }
    if (guilds.size > 1) {
      const guildList = guilds.map(g => `${g.name} (ID: ${g.id})`).join(', ');
      throw new Error(`Multiple servers found with name "${guildIdentifier}": ${guildList}. Please specify the server ID.`);
    }
    return guilds.first()!;
  }
  throw new Error(`Server "${guildIdentifier}" not found`);
}

// Helper function to find a channel by name or ID within a specific guild
async function findChannel(channelIdentifier: string, guildIdentifier?: string): Promise<TextChannel> {
  const guild = await findGuild(guildIdentifier);
  
  // First try to fetch by ID
  try {
    const channel = await client.channels.fetch(channelIdentifier);
    if (channel instanceof TextChannel && channel.guild.id === guild.id) {
      return channel;
    }
  } catch {
    // If fetching by ID fails, search by name in the specified guild
    const channels = guild.channels.cache.filter(
      (channel): channel is TextChannel =>
        channel instanceof TextChannel &&
        (channel.name.toLowerCase() === channelIdentifier.toLowerCase() ||
         channel.name.toLowerCase() === channelIdentifier.toLowerCase().replace('#', ''))
    );

    if (channels.size === 0) {
      const availableChannels = guild.channels.cache
        .filter((c): c is TextChannel => c instanceof TextChannel)
        .map(c => `"#${c.name}"`).join(', ');
      throw new Error(`Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`);
    }
    if (channels.size > 1) {
      const channelList = channels.map(c => `#${c.name} (${c.id})`).join(', ');
      throw new Error(`Multiple channels found with name "${channelIdentifier}" in server "${guild.name}": ${channelList}. Please specify the channel ID.`);
    }
    return channels.first()!;
  }
  throw new Error(`Channel "${channelIdentifier}" is not a text channel or not found in server "${guild.name}"`);
}

// Helper to find a forum channel by name or ID
async function findForumChannel(channelIdentifier: string, guildIdentifier?: string): Promise<ForumChannel> {
  const guild = await findGuild(guildIdentifier);

  // Try fetch by ID
  try {
    const channel = await client.channels.fetch(channelIdentifier);
    if (channel && channel.type === ChannelType.GuildForum && 'guild' in channel && (channel as ForumChannel).guild.id === guild.id) {
      return channel as ForumChannel;
    }
  } catch {
    // fall through to name search
  }

  const forums = guild.channels.cache.filter(
    (c): c is ForumChannel =>
      c.type === ChannelType.GuildForum &&
      (c.name.toLowerCase() === channelIdentifier.toLowerCase() ||
       c.name.toLowerCase() === channelIdentifier.toLowerCase().replace('#', ''))
  );

  if (forums.size === 0) {
    const availableForums = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildForum)
      .map(c => `"#${c.name}" (${c.id})`).join(', ');
    throw new Error(`Forum channel "${channelIdentifier}" not found in server "${guild.name}". Available forum channels: ${availableForums || 'none'}`);
  }
  if (forums.size > 1) {
    const forumList = forums.map(c => `#${c.name} (${c.id})`).join(', ');
    throw new Error(`Multiple forum channels found: ${forumList}. Please specify the channel ID.`);
  }
  return forums.first()!;
}

// Helper to find any readable channel (text channel or thread)
async function findReadableChannel(channelIdentifier: string, guildIdentifier?: string): Promise<TextChannel | AnyThreadChannel> {
  const guild = await findGuild(guildIdentifier);

  // Try fetch by ID — works for text channels AND threads (forum posts)
  try {
    const channel = await client.channels.fetch(channelIdentifier);
    if (channel) {
      if (channel instanceof TextChannel && channel.guild.id === guild.id) {
        return channel;
      }
      if (channel.isThread() && channel.guild?.id === guild.id) {
        return channel;
      }
    }
  } catch {
    // fall through to name search
  }

  // Name search only works for text channels (threads don't have unique names)
  const channels = guild.channels.cache.filter(
    (channel): channel is TextChannel =>
      channel instanceof TextChannel &&
      (channel.name.toLowerCase() === channelIdentifier.toLowerCase() ||
       channel.name.toLowerCase() === channelIdentifier.toLowerCase().replace('#', ''))
  );

  if (channels.size === 0) {
    const availableChannels = guild.channels.cache
      .filter((c): c is TextChannel => c instanceof TextChannel)
      .map(c => `"#${c.name}"`).join(', ');
    throw new Error(`Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}. For forum posts, use the thread/post ID.`);
  }
  if (channels.size > 1) {
    const channelList = channels.map(c => `#${c.name} (${c.id})`).join(', ');
    throw new Error(`Multiple channels found: ${channelList}. Please specify the channel ID.`);
  }
  return channels.first()!;
}

// Updated validation schemas
const SendMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or ID'),
  message: z.string(),
});

const ReadMessagesSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or channel/thread ID'),
  limit: z.number().min(1).max(100).default(50),
});

const ListForumPostsSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Forum channel name (e.g., "bug-reports") or ID'),
  limit: z.number().min(1).max(25).default(10),
  include_archived: z.boolean().default(true).describe('Include archived/closed posts'),
});

const ReadForumPostSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  thread_id: z.string().describe('Forum post/thread ID'),
  limit: z.number().min(1).max(100).default(50),
});

const EditForumPostSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  thread_id: z.string().describe('Forum post/thread ID'),
  title: z.string().optional().describe('New title for the forum post'),
  archived: z.boolean().optional().describe('Set archived state'),
  locked: z.boolean().optional().describe('Set locked state'),
  tags: z.array(z.string()).optional().describe('Tag names to apply (replaces existing tags)'),
});

// Create server instance
const server = new Server(
  {
    name: "discord",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "send-message",
        description: "Send a message to a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Channel name (e.g., "general") or ID',
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
          },
          required: ["channel", "message"],
        },
      },
      {
        name: "read-messages",
        description: "Read recent messages from a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Channel name (e.g., "general") or ID',
            },
            limit: {
              type: "number",
              description: "Number of messages to fetch (max 100)",
              default: 50,
            },
          },
          required: ["channel"],
        },
      },
      {
        name: "list-forum-posts",
        description: "List recent posts/threads in a Discord forum channel",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Forum channel name (e.g., "bug-reports") or ID',
            },
            limit: {
              type: "number",
              description: "Number of posts to return (max 25)",
              default: 10,
            },
            include_archived: {
              type: "boolean",
              description: "Include archived/closed posts (default true)",
              default: true,
            },
          },
          required: ["channel"],
        },
      },
      {
        name: "read-forum-post",
        description: "Read all messages in a Discord forum post/thread",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            thread_id: {
              type: "string",
              description: "Forum post/thread ID",
            },
            limit: {
              type: "number",
              description: "Number of messages to fetch (max 100)",
              default: 50,
            },
          },
          required: ["thread_id"],
        },
      },
      {
        name: "edit-forum-post",
        description: "Edit a Discord forum post's title, archived/locked state, or tags",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            thread_id: {
              type: "string",
              description: "Forum post/thread ID",
            },
            title: {
              type: "string",
              description: "New title for the forum post",
            },
            archived: {
              type: "boolean",
              description: "Set archived state",
            },
            locked: {
              type: "boolean",
              description: "Set locked state",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tag names to apply (replaces existing tags)",
            },
          },
          required: ["thread_id"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "send-message": {
        const { channel: channelIdentifier, message, server: srv } = SendMessageSchema.parse(args);
        const channel = await findReadableChannel(channelIdentifier, srv);

        const sent = await channel.send(message);
        return {
          content: [{
            type: "text",
            text: `Message sent successfully to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}`,
          }],
        };
      }

      case "read-messages": {
        const { channel: channelIdentifier, server: srv, limit } = ReadMessagesSchema.parse(args);
        const channel = await findReadableChannel(channelIdentifier, srv);

        const messages = await channel.messages.fetch({ limit });
        const formattedMessages = Array.from(messages.values()).map(msg => ({
          channel: `#${channel.name}`,
          server: channel.guild.name,
          author: msg.author.tag,
          content: msg.content,
          timestamp: msg.createdAt.toISOString(),
          ...(msg.embeds.length > 0 && {
            embeds: msg.embeds.map(e => ({
              ...(e.title && { title: e.title }),
              ...(e.description && { description: e.description }),
              ...(e.fields.length > 0 && { fields: e.fields.map(f => ({ name: f.name, value: f.value })) }),
            })),
          }),
          ...(msg.attachments.size > 0 && {
            attachments: Array.from(msg.attachments.values()).map(a => a.url),
          }),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(formattedMessages, null, 2),
          }],
        };
      }

      case "list-forum-posts": {
        const { channel: channelIdentifier, server: srv, limit, include_archived } = ListForumPostsSchema.parse(args);
        const forum = await findForumChannel(channelIdentifier, srv);

        const allThreads: AnyThreadChannel[] = [];

        // Fetch active threads
        const { threads: activeThreads } = await forum.threads.fetchActive();
        for (const thread of activeThreads.values()) {
          if (thread.parentId === forum.id) allThreads.push(thread);
        }

        // Fetch archived threads if requested
        if (include_archived) {
          const archived = await forum.threads.fetchArchived({ type: 'public', limit: 100 });
          for (const thread of archived.threads.values()) {
            if (!allThreads.some(t => t.id === thread.id)) {
              allThreads.push(thread);
            }
          }
        }

        // Sort by creation date descending, take limit
        allThreads.sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0));
        const posts = allThreads.slice(0, limit);

        const formattedPosts = await Promise.all(posts.map(async (thread) => {
          // Fetch the first message (the "post body")
          const starter = await thread.fetchStarterMessage().catch(() => null);
          const tags = thread.appliedTags.map(tagId => {
            const tag = forum.availableTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
          });

          return {
            id: thread.id,
            title: thread.name,
            author: starter?.author?.tag ?? thread.ownerId ?? 'unknown',
            created: thread.createdAt?.toISOString() ?? 'unknown',
            archived: thread.archived ?? false,
            locked: thread.locked ?? false,
            messageCount: thread.messageCount ?? 0,
            tags,
            body: starter?.content ?? '',
            ...(starter?.embeds && starter.embeds.length > 0 && {
              embeds: starter.embeds.map(e => ({
                ...(e.title && { title: e.title }),
                ...(e.description && { description: e.description }),
                ...(e.fields.length > 0 && { fields: e.fields.map(f => ({ name: f.name, value: f.value })) }),
              })),
            }),
            ...(starter?.attachments && starter.attachments.size > 0 && {
              attachments: Array.from(starter.attachments.values()).map(a => a.url),
            }),
          };
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              forum: `#${forum.name}`,
              server: forum.guild.name,
              postCount: formattedPosts.length,
              posts: formattedPosts,
            }, null, 2),
          }],
        };
      }

      case "read-forum-post": {
        const { thread_id, server: srv, limit } = ReadForumPostSchema.parse(args);
        const guild = await findGuild(srv);

        const thread = await client.channels.fetch(thread_id);
        if (!thread || !thread.isThread()) {
          throw new Error(`Thread "${thread_id}" not found or is not a thread/forum post`);
        }
        if (thread.guild?.id !== guild.id) {
          throw new Error(`Thread "${thread_id}" does not belong to server "${guild.name}"`);
        }

        const messages = await thread.messages.fetch({ limit });
        const sorted = Array.from(messages.values()).sort(
          (a, b) => a.createdTimestamp - b.createdTimestamp
        );

        const formattedMessages = sorted.map(msg => ({
          author: msg.author.tag,
          content: msg.content,
          timestamp: msg.createdAt.toISOString(),
          ...(msg.embeds.length > 0 && {
            embeds: msg.embeds.map(e => ({
              ...(e.title && { title: e.title }),
              ...(e.description && { description: e.description }),
              ...(e.fields.length > 0 && { fields: e.fields.map(f => ({ name: f.name, value: f.value })) }),
            })),
          }),
          ...(msg.attachments.size > 0 && {
            attachments: Array.from(msg.attachments.values()).map(a => a.url),
          }),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              thread: thread.name,
              forum: thread.parent ? `#${thread.parent.name}` : 'unknown',
              server: thread.guild.name,
              messages: formattedMessages,
            }, null, 2),
          }],
        };
      }

      case "edit-forum-post": {
        const { thread_id, server: srv, title, archived, locked, tags } = EditForumPostSchema.parse(args);
        const guild = await findGuild(srv);

        const thread = await client.channels.fetch(thread_id);
        if (!thread || !thread.isThread()) {
          throw new Error(`Thread "${thread_id}" not found or is not a thread/forum post`);
        }
        if (thread.guild?.id !== guild.id) {
          throw new Error(`Thread "${thread_id}" does not belong to server "${guild.name}"`);
        }

        const editOptions: Record<string, unknown> = {};
        if (title !== undefined) editOptions.name = title;
        if (archived !== undefined) editOptions.archived = archived;
        if (locked !== undefined) editOptions.locked = locked;
        if (tags !== undefined && thread.parent && thread.parent.type === ChannelType.GuildForum) {
          const forum = thread.parent as ForumChannel;
          const tagIds = tags.map(tagName => {
            const found = forum.availableTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
            if (!found) throw new Error(`Tag "${tagName}" not found. Available: ${forum.availableTags.map(t => t.name).join(', ')}`);
            return found.id;
          });
          editOptions.appliedTags = tagIds;
        }

        if (Object.keys(editOptions).length === 0) {
          throw new Error('No changes specified — provide at least one of: title, archived, locked, tags');
        }

        await thread.edit(editOptions);

        return {
          content: [{
            type: "text",
            text: `Forum post "${thread.name}" updated successfully in ${thread.guild.name}.`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Discord client login and error handling
client.once('ready', () => {
  console.error('Discord bot is ready!');
});

// Start the server
async function main() {
  // Check for Discord token
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is not set');
  }
  
  try {
    // Login to Discord
    await client.login(token);

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Discord MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main();