import React from 'react';

interface IntegrationsPanelProps {
  searxngUrl: string;
  onUpdateSearxngUrl: (url: string) => void;
  mcpServersJson: string;
  onUpdateMcpServersJson?: (json: string) => void;
}

/** SearXNG and local MCP — kept off the endpoint list. */
export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({
  searxngUrl,
  onUpdateSearxngUrl,
  mcpServersJson,
  onUpdateMcpServersJson
}) => (
  <div className="flex-1 overflow-y-auto p-4 space-y-4">
    <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-2">
      <label className="text-xs font-semibold text-zinc-200" htmlFor="searxng-url">
        SearXNG
      </label>
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        Base URL for the local search tool. Leave blank to skip web search.
      </p>
      <input
        id="searxng-url"
        type="text"
        value={searxngUrl}
        placeholder="http://127.0.0.1:8080"
        onChange={e => onUpdateSearxngUrl(e.target.value.trim())}
        className="w-full select-text bg-[#18181d] border border-[#2c2c38] text-zinc-200 rounded px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-indigo-500"
      />
    </div>

    <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-2">
      <label className="text-xs font-semibold text-zinc-200" htmlFor="mcp-json">
        Local MCP
      </label>
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        JSON array of stdio servers. Each entry needs name, command, and args. Remote URLs are ignored.
      </p>
      <textarea
        id="mcp-json"
        value={mcpServersJson}
        placeholder={'[{"name":"local","command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}]'}
        onChange={e => onUpdateMcpServersJson?.(e.target.value)}
        rows={8}
        spellCheck={false}
        className="w-full select-text bg-[#18181d] border border-[#2c2c38] text-zinc-200 rounded px-2.5 py-2 text-[11px] font-mono outline-none focus:border-indigo-500 resize-y min-h-[8rem]"
      />
    </div>
  </div>
);
