package main
import "syscall/js"
func valid(this js.Value,args []js.Value) interface{} { if len(args)==0{return false}; b:=args[0].String(); return len(b)>=4 && b[:4]=="%PDF" }
func main(){js.Global().Set("privaPdfBridge",js.ValueOf(map[string]interface{}{"version":1,"validPdfHeader":js.FuncOf(valid)}));select{}}
