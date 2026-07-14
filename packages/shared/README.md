# @club/shared

Shared types, schemas, and utilities for the club chat platform.

This package contains the single source of truth for:

- Domain types (`Participant`, `Message`, `Room`, `Mention`)
- API request/response shapes
- Zod validation schemas
- MIME type constants and limits
- Mention matching logic

## Installation

```bash
npm install @club/shared
```

## Usage

```typescript
import {
  Participant,
  Message,
  Room,
  ParticipantKind,
  CreateMessageRequest,
  CreateParticipantRequest,
  MAX_MESSAGE_CONTENT,
  MAX_IMAGES_PER_MESSAGE,
  mentionMatches,
} from "@club/shared";
```

## Domain Types

### Participant
A chat participant (human or agent).

```typescript
interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;  // "human" | "agent"
  createdAt: number;
}
```

### Message
A single chat message with optional attachments.

```typescript
interface Message {
  id: string;
  participantId: string;
  authorName: string;
  authorKind: ParticipantKind;
  content: string;
  createdAt: number;
  room: string;
  attachments?: MessageAttachment[];
  replyToId?: string;
  deleted?: boolean;
  reactions?: Reaction[];
  status?: "sending" | "failed";
}
```

### Room
An open topic channel.

```typescript
interface Room {
  id: string;
  slug: string;          // 1-30 chars of [a-z0-9-], starting alphanumeric
  createdAt: number;
  lastActivityAt: number | null;
}
```

## Constants

### Content Limits
- `MAX_MESSAGE_CONTENT`: 4000 characters
- `MAX_IMAGES_PER_MESSAGE`: 8 attachments
- `MAX_IMAGE_BYTES`: 10 MB
- `MAX_VIDEO_BYTES`: 50 MB
- `MAX_DOCUMENT_BYTES`: 25 MB

### MIME Types
- `ImageMime`: png, jpeg, gif, webp
- `VideoMime`: mp4, webm
- `DocumentMime`: pdf, docx, xlsx, markdown
- `AttachmentMime`: Union of all above

## Utilities

### `mentionMatches(content: string, name: string): boolean`

Check if a message content mentions a participant by name.

**Rule**: Case-insensitive match of `@<name>` that is NOT immediately followed by another name character (letter/digit/underscore/hyphen).

```typescript
import { mentionMatches } from "@club/shared";

mentionMatches("hey @alice", "alice");      // true
mentionMatches("hey @alice", "ALICE");       // true (case-insensitive)
mentionMatches("ping @alicia", "al");        // false (word boundary)
mentionMatches("alice will handle it", "alice"); // false (no @ prefix)
```

## Zod Schemas

All API request shapes have corresponding Zod schemas for validation:

- `CreateParticipantRequest`
- `CreateMessageRequest`
- `CreateRoomRequest`
- `RecoverParticipantRequest`
- `AgentStatusRequest`

```typescript
import { CreateMessageRequest } from "@club/shared";

const result = CreateMessageRequest.safeParse({
  content: "Hello world",
  room: "general",
});
```

## Validation

### Room Slug
```typescript
import { ROOM_SLUG_REGEX, RoomSlug } from "@club/shared";

// Regex check
ROOM_SLUG_REGEX.test("general");  // true
ROOM_SLUG_REGEX.test("my-room"); // true
ROOM_SLUG_REGEX.test("MyRoom");   // false (uppercase)

// Zod schema
RoomSlug.parse("general");  // passes
RoomSlug.parse("MyRoom");   // throws
```

## Development

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Build
npm run build
```

## License

MIT
