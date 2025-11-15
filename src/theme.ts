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
                    },
                    '&.Mui-disabled': {
                        backgroundColor: '#b5b5b5',
                        color: '#000000',
                        borderColor: '#b5b5b5'
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
                    },
                    '& .MuiInputLabel-root': {
                        color: '#000000',
                        '&.Mui-focused': {
                            color: '#000000'
                        },
                        '&.Mui-disabled': {
                            color: 'rgba(0,0,0,0.4)'
                        }
                    }
                }
            }
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    fontWeight: 500,
                    color: '#000000',
                    border: '1px solid #000000',
                    '&.MuiChip-filled': {
                        backgroundColor: '#ffffff'
                    },
                    '& .MuiChip-deleteIcon': {
                        color: '#000000',
                        '&:hover': {
                            color: '#000000'
                        }
                    }
                }
            }
        },
        MuiCheckbox: {
            styleOverrides: {
                root: {
                    padding: 4,
                    color: '#000000',
                    '& .MuiSvgIcon-root': {
                        borderRadius: 6,
                        border: '1px solid rgba(0,0,0,0.4)',
                        backgroundColor: '#ffffff',
                        transition: 'border-color 0.2s ease, color 0.2s ease'
                    },
                    '&:hover .MuiSvgIcon-root': {
                        borderColor: 'rgba(0,0,0,0.7)'
                    },
                    '&.Mui-checked': {
                        color: '#000000'
                    },
                    '&.Mui-checked .MuiSvgIcon-root': {
                        borderColor: '#000000',
                        color: '#000000'
                    }
                }
            }
        },
        MuiSwitch: {
            styleOverrides: {
                root: {
                    padding: 8
                },
                track: {
                    borderRadius: 20,
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.4)',
                    opacity: 1,
                    transition: 'background-color 0.2s ease'
                },
                thumb: {
                    boxShadow: 'none',
                    backgroundColor: '#000000'
                },
                switchBase: {
                    '&.Mui-checked': {
                        color: '#000000',
                        '& .MuiSwitch-thumb': {
                            backgroundColor: '#000000'
                        },
                        '& + .MuiSwitch-track': {
                            backgroundColor: '#b5b5b5',
                            borderColor: '#000000',
                            opacity: 1
                        }
                    }
                }
            }
        }
    }
});

export default theme;

