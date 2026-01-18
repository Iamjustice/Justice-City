import { useAuth } from "@/lib/auth";
import { useConversations } from "@/hooks/use-data";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, MessageSquare, Loader2 } from "lucide-react";
import { useState } from "react";
import { ChatInterface } from "@/components/chat-interface";
import { cn } from "@/lib/utils";

/**
 * ChatPage Component:
 * Displays a list of all active conversations for the current user.
 */
export default function ChatPage() {
  const { user } = useAuth();
  const { data: conversations, isLoading } = useConversations(user?.id);
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);

  if (!user) return <div className="p-20 text-center text-slate-500 font-medium">Please log in to view your messages.</div>;

  const selectedConvo = conversations?.find(c => c.id === selectedConvoId);

  // Helper to determine the other participant
  const getOtherParticipant = (convo: any) => {
    return convo.participant1Id === user.id ? convo.participant2 : convo.participant1;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-display font-bold text-slate-900 mb-8 flex items-center gap-3">
        <MessageSquare className="w-8 h-8 text-blue-600" />
        Messages
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-[700px]">
        {/* Conversations List */}
        <Card className="md:col-span-1 overflow-hidden flex flex-col">
          <CardHeader className="border-b bg-slate-50/50">
            <CardTitle className="text-lg">Recent Chats</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : conversations?.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm italic">
                No conversations yet. Start one from a property page.
              </div>
            ) : (
              <ScrollArea className="h-full">
                {conversations?.map((convo: any) => {
                  const other = getOtherParticipant(convo);
                  return (
                    <div
                      key={convo.id}
                      onClick={() => setSelectedConvoId(convo.id)}
                      className={cn(
                        "p-4 border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50",
                        selectedConvoId === convo.id && "bg-blue-50/50 border-r-4 border-r-blue-600"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Avatar>
                            <AvatarImage src={other?.avatar} />
                            <AvatarFallback>{other?.name?.charAt(0)}</AvatarFallback>
                          </Avatar>
                          {other?.isVerified && (
                            <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                              <ShieldCheck className="w-3 h-3 text-green-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <p className="font-semibold text-slate-900 text-sm truncate">{other?.name}</p>
                            <span className="text-[10px] text-slate-400 uppercase font-bold">
                              {new Date(convo.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-blue-600 font-medium truncate mb-1">
                            {convo.property?.title || "Professional Service"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Selected Conversation Interface */}
        <Card className="md:col-span-2 overflow-hidden flex flex-col">
          {selectedConvo ? (
            <ChatInterface
              conversationId={selectedConvo.id}
              recipient={{
                name: getOtherParticipant(selectedConvo)?.name,
                image: getOtherParticipant(selectedConvo)?.avatar,
                verified: getOtherParticipant(selectedConvo)?.isVerified,
              }}
              propertyTitle={(selectedConvo as any).property?.title || "Professional Service"}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-50/30">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Select a conversation</h3>
              <p className="text-slate-500 max-w-xs mx-auto mt-2">
                Choose a chat from the sidebar to view your message history and continue talking.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
