import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ShieldCheck, MoreVertical, Paperclip, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useMessages, useSendMessage } from "@/hooks/use-data";

interface ChatInterfaceProps {
  conversationId: string;
  recipient: {
    name: string;
    image: string;
    verified: boolean;
  };
  propertyTitle: string;
  initialMessage?: string;
}

/**
 * ChatInterface Component:
 * Provides a real-time messaging interface for a specific conversation.
 */
export function ChatInterface({ conversationId, recipient, propertyTitle }: ChatInterfaceProps) {
  const { user } = useAuth();
  const [newMessage, setNewMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch live messages and setup mutation for sending
  const { data: messages, isLoading } = useMessages(conversationId);
  const sendMessage = useSendMessage();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !user) return;

    try {
      await sendMessage.mutateAsync({
        conversationId,
        senderId: user.id,
        content: newMessage,
      });
      setNewMessage("");
    } catch (error) {
      console.error("Failed to send message", error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar>
              <AvatarImage src={recipient.image} />
              <AvatarFallback>{recipient.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            {recipient.verified && (
              <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-green-600 fill-green-100" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 text-sm truncate">{recipient.name}</h3>
            <p className="text-xs text-slate-500 truncate max-w-[200px]">Re: {propertyTitle}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon">
          <MoreVertical className="w-4 h-4 text-slate-400" />
        </Button>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 bg-slate-50/30">
        <div className="space-y-4" ref={scrollRef}>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* Safety notice for every conversation */}
              <div className="flex justify-center">
                <div className="bg-amber-50 text-amber-800 text-[10px] px-3 py-1.5 rounded-full border border-amber-100 flex items-center gap-1.5 max-w-[90%] text-center uppercase font-bold tracking-wider">
                  <ShieldCheck className="w-3 h-3" />
                  Monitored by Justice City for your safety
                </div>
              </div>

              {messages?.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex w-full",
                    msg.senderId === user?.id ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm",
                      msg.senderId === user?.id
                        ? "bg-blue-600 text-white rounded-br-none"
                        : "bg-white border border-slate-200 text-slate-800 rounded-bl-none"
                    )}
                  >
                    <p>{msg.content}</p>
                    <p className={cn(
                      "text-[10px] mt-1 text-right",
                      msg.senderId === user?.id ? "text-blue-100" : "text-slate-400"
                    )}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Message Input Area */}
      <div className="p-3 bg-white border-t border-slate-100 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-600 shrink-0">
          <Paperclip className="w-5 h-5" />
        </Button>
        <Input 
          placeholder="Type a message..." 
          className="flex-1 bg-slate-50 border-transparent focus-visible:ring-1 focus-visible:ring-blue-500"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={sendMessage.isPending}
        />
        <Button 
          size="icon" 
          className="bg-blue-600 hover:bg-blue-700 shrink-0"
          onClick={handleSend}
          disabled={sendMessage.isPending || !newMessage.trim()}
        >
          {sendMessage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
