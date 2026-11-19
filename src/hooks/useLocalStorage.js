import { useState } from 'react';
export default function useLocalStorage(key, initial) {
 const [error,setError]=useState('');
 const [value,setValue]=useState(()=>{try{return JSON.parse(localStorage.getItem(key))??initial}catch{return initial}});
 const update=next=>setValue(old=>{const result=typeof next==='function'?next(old):next;try{localStorage.setItem(key,JSON.stringify(result));setError('')}catch{setError('No se pudo guardar. Revisa los permisos o el espacio del navegador.')}return result});
 return [value,update,error];
}
