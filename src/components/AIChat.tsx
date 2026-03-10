// @ts-nocheck
"use client";

import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Bot, User } from 'lucide-react';

export default function AIChat() {
    const [isOpen, setIsOpen] = useState(false);
    const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
        api: '/api/chat',
    });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <>
            {/* Floating Action Button */}
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed bottom-6 right-6 p-4 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-transform duration-300 z-50 ${isOpen ? 'scale-0' : 'scale-100'}`}
            >
                <MessageSquare size={24} />
            </button>

            {/* Chat Window */}
            <div
                className={`fixed bottom-6 right-6 w-96 h-[32rem] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col z-50 transition-all duration-300 transform origin-bottom-right ${isOpen ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'}`}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-zinc-800 bg-indigo-600 text-white rounded-t-2xl">
                    <div className="flex items-center space-x-2">
                        <Bot size={20} />
                        <h3 className="font-semibold">Planning Assistant</h3>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="text-indigo-100 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Messages Center */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50 dark:bg-zinc-900/50">
                    {messages.length === 0 && (
                        <div className="text-center text-gray-500 dark:text-gray-400 mt-8 text-sm">
                            <Bot size={32} className="mx-auto mb-2 opacity-50" />
                            <p>Hi! I'm your AI-powered assistant. How can I help you adjust your school schedule today?</p>
                        </div>
                    )}
                    {messages.map((m: any) => (
                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-sm'
                                : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-gray-800 dark:text-gray-200 rounded-bl-sm shadow-sm'
                                }`}>
                                {m.content}
                            </div>
                        </div>
                    ))}
                    {error && (
                        <div className="flex justify-start">
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm text-sm">
                                Error: {error.message}
                            </div>
                        </div>
                    )}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex space-x-2">
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Form */}
                <form onSubmit={handleSubmit} className="p-3 border-t border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-b-2xl flex items-center space-x-2">
                    <input
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Ask about your schedule..."
                        className="flex-1 bg-gray-100 dark:bg-zinc-800 border-transparent focus:border-indigo-500 focus:ring-0 rounded-full px-4 py-2 text-sm text-gray-900 dark:text-gray-100"
                    />
                    <button
                        type="submit"
                        disabled={!input?.trim()}
                        className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        <Send size={18} />
                    </button>
                </form>
            </div>
        </>
    );
}
