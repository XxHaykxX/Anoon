import {
  SearchIcon,
  PlusIcon,
  SlidersIcon,
  ChatIcon,
  PhoneIcon,
  LockIcon,
} from "@/components/icons";

/* Calm, desaturated avatar gradients — shared visual language across screens. */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)", // slate
  "linear-gradient(135deg, #93BEA0 0%, #64977B 100%)", // sage
  "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)", // rose
  "linear-gradient(135deg, #E7B75F 0%, #C98F3B 100%)", // amber
  "linear-gradient(135deg, #A995C9 0%, #7F68A8 100%)", // violet
  "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)", // teal
] as const;

const backgroundChats = [
  { name: "Olivia Bennett", preview: "See you at 7pm!" },
  { name: "Marcus Reyes", preview: "Sounds good, thanks." },
  { name: "Priya Nadal", preview: "Sent the files over." },
  { name: "Group: Weekend Trip", preview: "Ethan: I'm in!" },
  { name: "Daniel Kim", preview: "Call me when free." },
];

interface SheetContact {
  name: string;
  initials: string;
  seen: string;
  locked: boolean;
  tone: number;
}

const contacts: SheetContact[] = [
  { name: "Aaron Whitfield", initials: "AW", seen: "Seen 5 minutes ago", locked: false, tone: 0 },
  { name: "Abigail Carter", initials: "AC", seen: "Seen 5 minutes ago", locked: true, tone: 2 },
  { name: "Adrian Foster", initials: "AF", seen: "Seen 5 minutes ago", locked: false, tone: 5 },
  { name: "Alina Marsh", initials: "AM", seen: "Seen 5 minutes ago", locked: false, tone: 3 },
];

export default function ContactsSheetScreen() {
  return (
    <div className="w-full h-full relative overflow-hidden bg-background text-foreground">
      {/* BACKGROUND: faint Chats list */}
      <div className="absolute inset-0 opacity-40">
        <div className="px-4 pt-6 pb-3">
          <h1 className="text-2xl font-bold text-foreground">Chats</h1>
        </div>
        <div className="flex flex-col">
          {backgroundChats.map((chat) => (
            <div
              key={chat.name}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="w-11 h-11 rounded-full bg-muted shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground truncate">
                  {chat.name}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {chat.preview}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DIM overlay */}
      <div className="absolute inset-0 bg-black/30" />

      {/* BOTTOM SHEET */}
      <div className="absolute left-0 right-0 bottom-0 h-[78%] bg-background rounded-t-3xl shadow-2xl flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center">
          <div className="w-9 h-1 rounded-full bg-muted my-2.5" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-xl font-bold text-foreground">Contacts</h2>
          <div className="flex items-center gap-4">
            <PlusIcon className="w-5 h-5 text-foreground" />
            <SlidersIcon className="w-5 h-5 text-foreground" />
            <SearchIcon className="w-5 h-5 text-foreground" />
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <span className="bg-primary text-primary-foreground rounded-full px-4 py-1.5 text-sm font-medium">
            All 392
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-4 py-1.5 text-sm font-medium">
            Family 7
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-4 py-1.5 text-sm font-medium">
            Friends 34
          </span>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto px-4">
          <div className="text-xs font-semibold text-muted-foreground py-1.5">
            A
          </div>
          <div className="flex flex-col">
            {contacts.map((contact) => (
              <div
                key={contact.name}
                className="flex items-center gap-3 py-2.5 border-b border-border last:border-b-0"
              >
                <div
                  className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center"
                  style={{ background: AVATAR_GRADIENTS[contact.tone % AVATAR_GRADIENTS.length] }}
                >
                  <span className="text-xs font-semibold text-white/95">
                    {contact.initials}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground truncate">
                      {contact.name}
                    </span>
                    {contact.locked && (
                      <LockIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {contact.seen}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <ChatIcon className="w-5 h-5 text-primary" />
                  <PhoneIcon className="w-5 h-5 text-primary" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom mini sub-nav */}
        <div className="border-t border-border flex justify-around py-2.5">
          <ChatIcon className="w-5 h-5 text-muted-foreground" />
          <PhoneIcon className="w-5 h-5 text-primary" />
          <SlidersIcon className="w-5 h-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
