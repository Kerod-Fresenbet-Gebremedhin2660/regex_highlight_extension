import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#64b5f6'
        },
        secondary: {
            main: '#ffb74d'
        },
        background: {
            default: '#000000',
            paper: '#111821'
        },
        text: {
            primary: '#f5f7fb',
            secondary: '#c1c9d6'
        }
    },
    shape: {
        borderRadius: 12
    },
    components: {
        MuiPaper: {
            styleOverrides: {
                root: {
                    backdropFilter: 'blur(8px)',
                    backgroundImage: 'linear-gradient(145deg, rgba(17,24,33,0.95), rgba(10,12,16,0.95))'
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
                    borderRadius: 10
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
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        borderRadius: 10
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

