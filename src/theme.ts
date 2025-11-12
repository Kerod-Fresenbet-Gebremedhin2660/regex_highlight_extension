import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#ffffff',
            contrastText: '#000000'
        },
        secondary: {
            main: '#f4f4f4',
            contrastText: '#000000'
        },
        background: {
            default: '#ffffff',
            paper: '#ffffff'
        },
        text: {
            primary: '#000000',
            secondary: '#3a3a3a'
        },
        divider: '#cfcfcf'
    },
    shape: {
        borderRadius: 12
    },
    components: {
        MuiPaper: {
            styleOverrides: {
                root: {
                    backdropFilter: 'blur(4px)',
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
                }
            }
        },
        MuiButton: {
            defaultProps: {
                variant: 'contained',
                disableElevation: true,
                size: 'medium'
            },
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    borderRadius: 10,
                    backgroundColor: '#ffffff',
                    color: '#000000',
                    border: '1px solid rgba(0,0,0,0.15)',
                    boxShadow: 'none',
                    '&:hover': {
                        backgroundColor: '#f3f3f3',
                        boxShadow: 'none'
                    }
                }
            }
        },
        MuiTextField: {
            defaultProps: {
                variant: 'outlined'
            },
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        backgroundColor: '#ffffff',
                        borderRadius: 10,
                        color: '#000000',
                        '& fieldset': {
                            borderColor: 'rgba(0,0,0,0.15)'
                        },
                        '&:hover fieldset': {
                            borderColor: 'rgba(0,0,0,0.25)'
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: '#000000'
                        }
                    }
                }
            }
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    fontWeight: 500
                }
            }
        }
    }
});

export default theme;

