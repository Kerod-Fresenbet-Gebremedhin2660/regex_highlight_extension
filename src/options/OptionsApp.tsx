import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Container, Stack, TextField, Typography, Paper } from '@mui/material';

const STORAGE_KEY = 'domainWhitelist';
const DEFAULT_WHITELIST = ['archiveofourown.org', 'fanfiction.net'];

function normalizeDomain(input: string): string | null {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    try {
        // Accept raw domain, with/without protocol or path
        if (trimmed.includes('://')) {
            const url = new URL(trimmed);
            return url.hostname.replace(/^www\./, '');
        }
        // Strip protocol-less paths
        const cleaned = trimmed.replace(/^www\./, '').split('/')[0];
        // Basic validation: has at least one dot
        if (!cleaned.includes('.')) return null;
        return cleaned;
    } catch {
        return null;
    }
}

const OptionsApp = () => {
    const [domains, setDomains] = useState<string[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
            const stored = Array.isArray(result?.[STORAGE_KEY]) ? (result[STORAGE_KEY] as string[]) : null;
            if (stored && stored.length > 0) {
                setDomains(stored);
            } else {
                // Initialize with defaults if empty
                setDomains(DEFAULT_WHITELIST);
                chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_WHITELIST });
            }
            setLoading(false);
        });
    }, []);

    const handleAdd = () => {
        setError(null);
        const normalized = normalizeDomain(input);
        if (!normalized) {
            setError('Enter a valid domain (e.g., example.com)');
            return;
        }
        if (domains.includes(normalized)) {
            setError('Domain already in the list');
            return;
        }
        const next = [...domains, normalized];
        setDomains(next);
        chrome.storage.sync.set({ [STORAGE_KEY]: next });
        setInput('');
    };

    const handleRemove = (domain: string) => {
        const next = domains.filter((d) => d !== domain);
        setDomains(next);
        chrome.storage.sync.set({ [STORAGE_KEY]: next });
    };

    const helperText = useMemo(() => {
        if (error) return error;
        return 'Add domains where the widget is allowed (e.g., archiveofourown.org)';
    }, [error]);

    return (
        <Container maxWidth="sm" sx={{ py: 4 }}>
            <Paper elevation={8} sx={{ p: 3 }}>
                <Stack spacing={3}>
                    <Typography variant="h5" fontWeight={700}>
                        Regex Highlight — Site Allowlist
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        The widget will only appear and work on the domains listed below.
                    </Typography>
                    <Stack direction="row" spacing={1}>
                        <TextField
                            fullWidth
                            size="small"
                            label="Add domain"
                            placeholder="example.com"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            error={Boolean(error)}
                            helperText={helperText}
                        />
                        <Button
                            variant="contained"
                            onClick={handleAdd}
                            disabled={loading || input.trim().length === 0}
                            size="small"
                            sx={{ height: 40 }}
                        >
                            Add
                        </Button>
                    </Stack>
                    <Box>
                        {domains.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No domains yet.
                            </Typography>
                        ) : (
                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                {domains.map((domain) => (
                                    <Chip key={domain} label={domain} onDelete={() => handleRemove(domain)} />
                                ))}
                            </Stack>
                        )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                        Default domains: archiveofourown.org, fanfiction.net
                    </Typography>
                </Stack>
            </Paper>
        </Container>
    );
};

export default OptionsApp;


